<script setup lang="ts">
import { useChatLinks } from './links';
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { MessageSquare, Pencil, SmilePlus, Trash2 } from 'lucide-vue-next';
import { Button, ConfirmDialog, Editor, IconButton, mutate, newId } from '@planar/web/modules';
import RichBody from './RichBody';
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
  /** начать правку (↑ в пустом поле ввода) */
  edit?: boolean;
}>();
const emit = defineEmits<{ editDone: [] }>();
const tx = useTexts();
const m = computed(() => props.message);
const author = computed(() => props.users.get(m.value.authorId)?.name ?? tx('unknown'));
// лента монтирует десятки строк за кадр: без Avatar/RouterLink/иконок-компонентов (CL-2b)
const router = useRouter();
const links = useChatLinks();
const threadTo = computed(() => links.thread(m.value.channelId, m.value.id));
const threadUrl = computed(() =>
  typeof threadTo.value === 'string' ? threadTo.value : router.resolve(threadTo.value).href,
);
function go(e: MouseEvent) {
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  void router.push(threadTo.value);
}
const mine = computed(() => m.value.authorId === props.me && !m.value.deletedAt);
const time = computed(() => hhmm.format(new Date(m.value.createdAt)));
const refs = computed(() => taskRefs(m.value.body).slice(0, 3));
const isImage = (mime: string) => mime.startsWith('image/');

const EMOJI = ['👍', '❤️', '😄', '🎉'];
// панель действий (иконки, кнопки) монтируется при наведении/фокусе: на быстрой прокрутке это треть стоимости строки
const armed = ref(false);
const picking = ref(false);
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
  picking.value = false;
  const mine = props.reactions.find((r) => r.userId === props.me && r.emoji === emoji);
  void mutate('chat.reaction.toggle', {
    id: newId(),
    messageId: m.value.id,
    emoji,
    ...(mine && { removeId: mine.id }),
  }).catch(() => {});
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
  if (draft.value)
    await mutate('chat.message.update', { id: m.value.id, body: plain(draft.value) });
  stopEdit();
}
// в правке Enter сохраняет (Shift+Enter — перенос), Esc — отмена; открытый список @ забирает Enter себе
function onEditEnter(e: KeyboardEvent) {
  if (e.isComposing || (e.currentTarget as HTMLElement).querySelector('[role=listbox]')) return;
  e.preventDefault();
  e.stopPropagation();
  void save();
}
const confirming = ref(false);
const remove = () => void mutate('chat.message.delete', { id: m.value.id }).catch(() => {});
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
          :label="tx('message')"
          @submit="save"
        />
        <div class="mt-1 flex gap-1">
          <Button type="submit" size="sm" variant="primary">{{ tx('save') }}</Button>
          <Button size="sm" @click="stopEdit">{{ tx('cancel') }}</Button>
        </div>
      </form>
      <template v-else>
        <RichBody :body="m.body" :me="me" />
        <TaskCard v-for="k in refs" :key="k" :task-key="k" />
        <ul v-if="m.attachments.length" class="mt-1 flex flex-wrap gap-2">
          <li v-for="a in m.attachments" :key="a.fileSha256">
            <a :href="`/files/${a.fileSha256}`" target="_blank" rel="noopener noreferrer">
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
    <div
      v-if="armed && !m.deletedAt"
      class="flex min-h-7 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
    >
      <template v-if="picking">
        <Button v-for="e in EMOJI" :key="e" size="sm" variant="ghost" @click="react(e)">
          {{ e }}
        </Button>
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
