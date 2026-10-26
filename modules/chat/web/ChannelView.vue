<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { EmptyState, db, mutate, newId } from '@planar/web/modules';
import Composer from './Composer.vue';
import MessageItem from './MessageItem.vue';
import { useFeed } from './feed';
import { ATTENTION, channelOfUrl, type Channel, type UserRow } from './model';
import { useTyping } from './typing';
import { useTexts } from './text';

const props = defineProps<{
  channel: Channel;
  users: Map<string, UserRow>;
  me: string;
  readSeq: number;
  members: { id: string; name: string }[];
  messageId?: string;
}>();
const tx = useTexts();
const feed = useFeed(props.channel.id);
const { messages } = feed;
// «Новые»: граница непрочитанного на момент открытия — не сдвигается, пока канал открыт
const since = props.channel.lastSeq > props.readSeq ? props.readSeq : null;
const firstNew = computed(() =>
  since === null
    ? undefined
    : messages.value.find((m) => (m.seq ?? 0) > since && m.authorId !== props.me)?.id,
);

const scroller = ref<HTMLElement | null>(null);
const virt = useVirtualizer(
  computed(() => ({
    count: messages.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (i: number) => messages.value[i]?.id ?? i,
    initialRect: { width: 800, height: 600 },
  })),
);
const items = computed(() => virt.value.getVirtualItems());
const total = computed(() => virt.value.getTotalSize());
const measure = (el: unknown) => el && virt.value.measureElement(el as Element);

// старт с низа; при прокрутке вверх подгружаем историю и держим позицию
let stick = true;
const toEnd = () =>
  nextTick(
    () =>
      messages.value.length &&
      virt.value.scrollToIndex(messages.value.length - 1, { align: 'end' }),
  );
const onScroll = () => {
  const el = scroller.value;
  if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
};
const positioned = ref(false);
const hl = ref('');
const notFound = ref(false);
let hlTimer: ReturnType<typeof setTimeout> | undefined;
async function jump(id: string) {
  notFound.value = false;
  if (!(await feed.ensure(id))) {
    notFound.value = true;
    return toEnd();
  }
  await nextTick();
  const i = messages.value.findIndex((m) => m.id === id);
  if (i < 0) return;
  virt.value.scrollToIndex(i, { align: 'center' });
  hl.value = id;
  clearTimeout(hlTimer);
  hlTimer = setTimeout(() => (hl.value = ''), 3000);
}
onMounted(async () => {
  await feed.loadOlder();
  if (props.messageId) await jump(props.messageId);
  else {
    // открыли непрочитанный — к первому новому, иначе в конец
    const i = messages.value.findIndex((m) => m.id === firstNew.value);
    if (i > 0) {
      await nextTick();
      virt.value.scrollToIndex(i, { align: 'start' });
    } else await toEnd();
  }
  positioned.value = true;
});
watch(
  () => props.messageId,
  (id) => id && positioned.value && void jump(id),
);
watch(
  messages,
  (cur, prev) => {
    if (!positioned.value || !cur.length || !prev.length) return;
    const i = cur.findIndex((m) => m.id === prev[0]!.id);
    if (i > 0)
      virt.value.scrollToIndex(i, { align: 'start' }); // страница истории сверху
    else if (cur.at(-1)!.id !== prev.at(-1)!.id && (stick || cur.at(-1)!.authorId === props.me))
      void toEnd();
  },
  { flush: 'post' },
);
watch(
  () => items.value[0]?.index,
  (i) => {
    if (positioned.value && i !== undefined && i <= 2) void feed.loadOlder();
  },
);

// прочтение: максимальный видимый seq, не чаще раза в секунду
let sent = 0;
let lastSent = 0;
let pending = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
function flush() {
  timer = undefined;
  sent = pending;
  lastSent = Date.now();
  void mutate('chat.read', {
    id: newId(),
    channelId: props.channel.id,
    lastReadSeq: pending,
  }).catch(() => {});
  void readAttention();
}
// прочитал канал — гаснут его уведомления (упоминания, 1:1) в счётчике чатов и колокольчике
async function readAttention() {
  const ids = (
    await db
      .table<{ id: string; kind: string; url: string | null; readAt: string | null }>(
        'notifications',
      )
      .toArray()
  )
    .filter(
      (n) => !n.readAt && ATTENTION.includes(n.kind) && channelOfUrl(n.url) === props.channel.id,
    )
    .map((n) => n.id);
  if (ids.length) await mutate('notification.read', { ids }).catch(() => {});
}
watch(
  () => {
    const r = virt.value.range;
    if (!r) return 0;
    return messages.value
      .slice(r.startIndex, r.endIndex + 1)
      .reduce((s, m) => Math.max(s, m.seq ?? 0), 0);
  },
  (seq) => {
    if (seq <= Math.max(props.readSeq, sent)) return;
    pending = seq;
    if (timer) return;
    const wait = 1000 - (Date.now() - lastSent);
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  },
);
onBeforeUnmount(() => (clearTimeout(timer), clearTimeout(hlTimer)));

const typing = useTyping(props.channel.id, () => props.me);
const typingText = computed(() => {
  const names = typing.value.map((u) => props.users.get(u)?.name ?? tx('unknown'));
  return names.length
    ? tx(names.length > 1 ? 'typingMany' : 'typing', { names: names.join(', ') })
    : '';
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="chat-feed">
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto" @scroll.passive="onScroll">
      <p v-if="feed.loading.value" class="p-2 text-center text-xs text-fg-subtle">
        {{ tx('loading') }}
      </p>
      <EmptyState v-else-if="!messages.length && positioned" :title="tx('noMessages')" />
      <p v-if="notFound" class="p-2 text-center text-xs text-fg-muted" data-testid="chat-not-found">
        {{ tx('msgNotFound') }}
      </p>
      <div :style="{ height: total + 'px', position: 'relative' }">
        <div
          v-for="vi in items"
          :key="String(vi.key)"
          :ref="measure"
          :data-index="vi.index"
          class="absolute left-0 top-0 w-full [contain:layout_style]"
          :style="{ transform: `translateY(${vi.start}px)` }"
        >
          <div
            v-if="messages[vi.index]?.id === firstNew"
            class="flex items-center gap-2 px-3 pt-2 text-xs font-medium text-danger"
            data-testid="chat-new-divider"
          >
            <span class="h-px flex-1 bg-danger/40" />{{ tx('newMessages')
            }}<span class="h-px flex-1 bg-danger/40" />
          </div>
          <MessageItem
            v-if="messages[vi.index]"
            :message="messages[vi.index]!"
            :reactions="feed.reactions.value.get(messages[vi.index]!.id) ?? []"
            :users="users"
            :me="me"
            :members="members"
            :highlight="hl === messages[vi.index]!.id"
          />
        </div>
      </div>
    </div>
    <p class="h-5 px-3 text-xs text-fg-muted" data-testid="chat-typing" aria-live="polite">
      {{ typingText }}
    </p>
    <Composer :channel-id="channel.id" :members="members" :disabled="!!channel.archivedAt" />
  </div>
</template>
