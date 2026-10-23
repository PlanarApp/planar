<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Editor, mutate, newId } from '@planar/web/modules';
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
}>();
const tx = useTexts();
const m = computed(() => props.message);
const author = computed(() => props.users.get(m.value.authorId)?.name ?? tx('unknown'));
// лента монтирует десятки строк за кадр: без Avatar/RouterLink/иконок-компонентов (CL-2b)
const router = useRouter();
const threadUrl = computed(() => `/m/chat/c/${m.value.channelId}/t/${m.value.id}`);
function go(e: MouseEvent) {
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  void router.push((e.currentTarget as HTMLAnchorElement).getAttribute('href')!);
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
  void mutate('chat.reaction.toggle', { id: newId(), messageId: m.value.id, emoji }).catch(
    () => {},
  );
};

const editing = ref(false);
const draft = ref<Record<string, unknown> | null>(null);
const startEdit = () => {
  draft.value = m.value.body as Record<string, unknown>;
  editing.value = true;
};
async function save() {
  if (draft.value)
    await mutate('chat.message.update', { id: m.value.id, body: plain(draft.value) });
  editing.value = false;
}
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
      <form v-else-if="editing" @submit.prevent="save">
        <Editor v-model="draft" :members="members" :label="tx('message')" @submit="save" />
        <div class="mt-1 flex gap-1">
          <Button type="submit" size="sm" variant="primary">{{ tx('save') }}</Button>
          <Button size="sm" @click="editing = false">{{ tx('cancel') }}</Button>
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
        <button
          v-for="g in grouped"
          :key="g.emoji"
          type="button"
          :aria-pressed="g.mine"
          :class="[
            'rounded-full border px-2 text-xs',
            g.mine ? 'border-accent bg-accent-subtle' : 'border-border',
          ]"
          @click="react(g.emoji)"
        >
          {{ g.emoji }} {{ g.n }}
        </button>
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
      class="flex h-6 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
    >
      <template v-if="picking">
        <button v-for="e in EMOJI" :key="e" type="button" class="px-0.5" @click="react(e)">
          {{ e }}
        </button>
      </template>
      <button v-else type="button" :aria-label="tx('react')" class="p-1" @click="picking = true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M22 11v1a10 10 0 1 1-9-10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" x2="9.01" y1="9" y2="9" />
          <line x1="15" x2="15.01" y1="9" y2="9" />
          <path d="M16 5h6" />
          <path d="M19 2v6" />
        </svg>
      </button>
      <a v-if="!inThread" :href="threadUrl" :aria-label="tx('reply')" class="p-1" @click="go"
        ><svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
          /></svg
      ></a>
      <template v-if="mine">
        <button type="button" :aria-label="tx('edit')" class="p-1" @click="startEdit">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
            />
            <path d="m15 5 4 4" />
          </svg>
        </button>
        <button type="button" :aria-label="tx('delete')" class="p-1" @click="remove">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </template>
    </div>
  </article>
</template>
