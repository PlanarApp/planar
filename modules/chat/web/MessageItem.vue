<script setup lang="ts">
import { useChatLinks } from './links';
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { MessageSquare, Pencil, Plus, SmilePlus, Trash2 } from 'lucide-vue-next';
import {
  Button,
  ConfirmDialog,
  Editor,
  EmojiPicker,
  IconButton,
  Popover,
  Sheet,
  mutate,
  newId,
  useBreakpoint,
} from '@planar/web/modules';
import RichBody from './RichBody';
import { toReplica } from './feed';
import TaskCard from './TaskCard.vue';
import {
  hhmm,
  hue,
  initials,
  plain,
  taskRefs,
  type Message,
  type Reaction,
  type UserRow,
} from './model';
import { useTexts } from './text';

const props = defineProps<{
  message: Message;
  reactions: Reaction[];
  users: Map<string, UserRow>;
  me: string;
  members: { id: string; name: string }[];
  inThread?: boolean;
  highlight?: boolean;
  /** start editing (↑ in an empty input field) */
  edit?: boolean;
}>();
const emit = defineEmits<{ editDone: [] }>();
const tx = useTexts();
const m = computed(() => props.message);
const author = computed(() => props.users.get(m.value.authorId)?.name ?? tx('unknown'));
// the feed mounts dozens of rows per frame: no Avatar/RouterLink/icon components (CL-2b)
const router = useRouter();
const links = useChatLinks();
const threadTo = computed(() => links.thread(m.value.channelId, m.value.id));
const threadUrl = computed(() =>
  typeof threadTo.value === 'string' ? threadTo.value : router.resolve(threadTo.value).href,
);
// internal links in the body (@@ task, @@@ document) — navigate within the app, not a new tab
function onBodyClick(e: MouseEvent) {
  const a = (e.target as Element).closest?.('a[data-internal]');
  if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  void router.push(a.getAttribute('href')!);
}
function go(e: MouseEvent) {
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  void router.push(threadTo.value);
}
const mine = computed(() => m.value.authorId === props.me && !m.value.deletedAt);
const time = computed(() => hhmm.format(new Date(m.value.createdAt)));
const refs = computed(() => taskRefs(m.value.body).slice(0, 3));
const isImage = (mime: string) => mime.startsWith('image/');
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

const EMOJI = ['👍', '❤️', '😄', '🎉'];
// the action panel (icons, buttons) is mounted on hover/focus: on fast scrolling it is a third of the row's cost
const armed = ref(false);
const picking = ref(false);
// the full emoji set for a reaction — the picker is mounted only when open
const more = ref(false);
// mobile: no hover — tapping the message opens the action sheet (mounted on tap)
const { isMobile } = useBreakpoint();
const sheet = ref(false);
const sheetRow =
  'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg';
// tap on the message itself (not on a link, button, task card, attachment)
function openSheet(e: MouseEvent) {
  if (!isMobile.value || m.value.deletedAt || editing.value) return;
  if ((e.target as Element).closest('a, button, input, img, [contenteditable], [role=button]'))
    return;
  sheet.value = true;
}
const act = (f: () => unknown) => {
  sheet.value = false;
  f();
};
const grouped = computed(() => {
  const g = new Map<string, Reaction[]>();
  for (const r of props.reactions) g.set(r.emoji, [...(g.get(r.emoji) ?? []), r]);
  return [...g].map(([emoji, rs]) => ({
    emoji,
    n: rs.length,
    mine: rs.some((r) => r.userId === props.me),
  }));
});
const react = (emoji: string) => {
  picking.value = more.value = false;
  const mine = props.reactions.find((r) => r.userId === props.me && r.emoji === emoji);
  void toReplica(m.value)
    .then(() =>
      mutate('chat.reaction.toggle', {
        id: newId(),
        messageId: m.value.id,
        emoji,
        ...(mine && { removeId: mine.id }),
      }),
    )
    .catch(() => {});
};

const editing = ref(false);
const draft = ref<Record<string, unknown> | null>(null);
const editor = ref<InstanceType<typeof Editor> | null>(null);
const startEdit = () => {
  draft.value = m.value.body as Record<string, unknown>;
  editing.value = true;
  void nextTick(() => editor.value?.focus());
};
watch(
  () => props.edit,
  (v) => v && mine.value && startEdit(),
  { immediate: true },
);
const stopEdit = () => {
  editing.value = false;
  emit('editDone');
};
async function save() {
  if (draft.value) {
    await toReplica(m.value);
    await mutate('chat.message.update', { id: m.value.id, body: plain(draft.value) });
  }
  stopEdit();
}
// while editing Enter saves (Shift+Enter — new line), Esc — cancel; an open @ list takes Enter for itself
function onEditEnter(e: KeyboardEvent) {
  if (e.isComposing || (e.currentTarget as HTMLElement).querySelector('[role=listbox]')) return;
  e.preventDefault();
  e.stopPropagation();
  void save();
}
const confirming = ref(false);
const remove = () =>
  void toReplica(m.value)
    .then(() => mutate('chat.message.delete', { id: m.value.id }))
    .catch(() => {});
</script>

<template>
  <article
    :data-testid="`chat-msg-${m.id}`"
    class="group flex gap-2 px-3 py-1.5 hover:bg-bg-muted/50"
    :class="highlight && 'bg-accent/10'"
    :data-highlight="highlight || undefined"
    tabindex="0"
    @pointerenter.once="armed = true"
    @focusin.once="armed = true"
    @click="openSheet"
  >
    <span
      :title="author"
      class="inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full text-[13px] font-medium text-white"
      :style="{ background: `hsl(${hue(author)} 45% 40%)` }"
      >{{ initials(author) }}</span
    >
    <div class="min-w-0 flex-1">
      <header class="flex items-baseline gap-2 text-sm">
        <span class="font-medium">{{ author }}</span>
        <time class="text-xs text-fg-subtle">{{ time }}</time>
        <span v-if="m.editedAt && !m.deletedAt" class="text-xs text-fg-subtle">{{
          tx('edited')
        }}</span>
      </header>
      <p v-if="m.deletedAt" class="text-sm italic text-fg-subtle">{{ tx('deleted') }}</p>
      <form
        v-else-if="editing"
        data-testid="chat-edit"
        @submit.prevent="save"
        @keydown.enter.exact.capture="onEditEnter"
        @keydown.esc.stop="stopEdit"
      >
        <Editor
          ref="editor"
          v-model="draft"
          :members="members"
          refs
          :label="tx('message')"
          @submit="save"
        />
        <div class="mt-1 flex gap-1">
          <Button type="submit" size="sm" variant="primary">{{ tx('save') }}</Button>
          <Button size="sm" @click="stopEdit">{{ tx('cancel') }}</Button>
        </div>
      </form>
      <template v-else>
        <RichBody :body="m.body" :me="me" @click="onBodyClick" />
        <TaskCard v-for="k in refs" :key="k" :task-key="k" />
        <ul v-if="m.attachments.length" class="mt-1 flex flex-wrap gap-2">
          <li v-for="a in m.attachments" :key="a.fileSha256">
            <span
              v-if="a.mime.startsWith('audio/')"
              class="flex items-center gap-2"
              data-testid="chat-voice-msg"
            >
              <audio
                controls
                preload="none"
                :src="`/files/${a.fileSha256}`"
                :aria-label="tx('voice')"
                class="h-9 max-w-72"
              />
              <span v-if="a.durationMs" class="text-xs text-fg-subtle">{{
                clock(a.durationMs)
              }}</span>
            </span>
            <a v-else :href="`/files/${a.fileSha256}`" target="_blank" rel="noopener noreferrer">
              <img
                v-if="isImage(a.mime)"
                :src="`/files/${a.fileSha256}`"
                :alt="a.name"
                loading="lazy"
                class="max-h-48 rounded-md border border-border"
              />
              <span v-else class="rounded-md bg-bg-muted px-2 py-1 text-sm underline">{{
                a.name
              }}</span>
            </a>
          </li>
        </ul>
      </template>
      <div
        v-if="!m.deletedAt && (grouped.length || (!inThread && m.replyCount > 0))"
        class="mt-1 flex flex-wrap items-center gap-1"
      >
        <Button
          v-for="g in grouped"
          :key="g.emoji"
          size="sm"
          :variant="g.mine ? 'secondary' : 'ghost'"
          :aria-pressed="g.mine"
          :class="g.mine && 'border-accent bg-accent-subtle'"
          @click="react(g.emoji)"
        >
          {{ g.emoji }} {{ g.n }}
        </Button>
        <a
          v-if="!inThread && m.replyCount > 0"
          :href="threadUrl"
          data-testid="chat-replies"
          class="text-xs text-accent hover:underline"
          @click="go"
          >{{ tx('replies', { n: m.replyCount }) }}</a
        >
      </div>
    </div>
    <template v-if="isMobile && !m.deletedAt">
      <Sheet v-if="sheet" v-model:open="sheet" :title="tx('actions')">
        <div class="flex justify-around py-1">
          <button
            v-for="e in EMOJI"
            :key="e"
            type="button"
            class="flex size-11 items-center justify-center rounded-md text-xl"
            @click="act(() => react(e))"
          >
            {{ e }}
          </button>
          <button
            type="button"
            :aria-label="tx('moreEmoji')"
            class="flex size-11 items-center justify-center rounded-md text-fg-muted"
            @click="more = !more"
          >
            <Plus :size="18" />
          </button>
        </div>
        <EmojiPicker v-if="more" class="pb-2" @pick="act(() => react($event))" />
        <button
          v-if="!inThread"
          type="button"
          :class="sheetRow"
          @click="act(() => router.push(threadTo))"
        >
          <MessageSquare :size="16" />{{ tx('reply') }}
        </button>
        <template v-if="mine">
          <button type="button" :class="sheetRow" @click="act(startEdit)">
            <Pencil :size="16" />{{ tx('edit') }}
          </button>
          <button
            type="button"
            :class="[sheetRow, 'text-danger']"
            @click="act(() => (confirming = true))"
          >
            <Trash2 :size="16" />{{ tx('delete') }}
          </button>
        </template>
      </Sheet>
      <ConfirmDialog
        v-if="confirming"
        v-model:open="confirming"
        :title="tx('deleteConfirm')"
        :confirm-label="tx('delete')"
        @confirm="remove"
      />
    </template>
    <div
      v-else-if="armed && !m.deletedAt"
      class="flex min-h-7 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
    >
      <template v-if="picking">
        <Button v-for="e in EMOJI" :key="e" size="sm" variant="ghost" @click="react(e)">
          {{ e }}
        </Button>
        <Popover v-model:open="more" align="start">
          <template #trigger>
            <IconButton :icon="Plus" :label="tx('moreEmoji')" size="sm" data-testid="emoji-more" />
          </template>
          <EmojiPicker v-if="more" @pick="react" />
        </Popover>
      </template>
      <IconButton v-else :icon="SmilePlus" :label="tx('react')" size="sm" @click="picking = true" />
      <a
        v-if="!inThread"
        :href="threadUrl"
        :aria-label="tx('reply')"
        class="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
        @click="go"
        ><MessageSquare :size="16"
      /></a>
      <template v-if="mine">
        <IconButton :icon="Pencil" :label="tx('edit')" size="sm" @click="startEdit" />
        <IconButton :icon="Trash2" :label="tx('delete')" size="sm" @click="confirming = true" />
        <ConfirmDialog
          v-if="confirming"
          v-model:open="confirming"
          :title="tx('deleteConfirm')"
          :confirm-label="tx('delete')"
          @confirm="remove"
        />
      </template>
    </div>
  </article>
</template>
