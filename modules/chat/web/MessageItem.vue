<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { MessageSquare, Pencil, SmilePlus, Trash2 } from 'lucide-vue-next';
import { Avatar, Button, Editor, mutate, newId } from '@planar/web/modules';
import RichBody from './RichBody';
import TaskCard from './TaskCard.vue';
import { plain, taskRefs, type Message, type Reaction, type UserRow } from './model';
import { useTexts } from './text';

const props = defineProps<{
  message: Message;
  reactions: Reaction[];
  users: Map<string, UserRow>;
  me: string;
  members: { id: string; name: string }[];
  inThread?: boolean;
}>();
const tx = useTexts();
const m = computed(() => props.message);
const author = computed(() => props.users.get(m.value.authorId)?.name ?? tx('unknown'));
const mine = computed(() => m.value.authorId === props.me && !m.value.deletedAt);
const time = computed(() =>
  new Date(m.value.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
);
const refs = computed(() => taskRefs(m.value.body).slice(0, 3));
const isImage = (mime: string) => mime.startsWith('image/');

const EMOJI = ['👍', '❤️', '😄', '🎉'];
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
  >
    <Avatar :name="author" size="lg" />
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
      <div v-if="!m.deletedAt" class="mt-1 flex flex-wrap items-center gap-1">
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
        <RouterLink
          v-if="!inThread && m.replyCount > 0"
          :to="`/m/chat/c/${m.channelId}/t/${m.id}`"
          data-testid="chat-replies"
          class="text-xs text-accent hover:underline"
          >{{ tx('replies', { n: m.replyCount }) }}</RouterLink
        >
      </div>
    </div>
    <div
      v-if="!m.deletedAt"
      class="flex h-6 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
    >
      <template v-if="picking">
        <button v-for="e in EMOJI" :key="e" type="button" class="px-0.5" @click="react(e)">
          {{ e }}
        </button>
      </template>
      <button v-else type="button" :aria-label="tx('react')" class="p-1" @click="picking = true">
        <SmilePlus :size="14" />
      </button>
      <RouterLink
        v-if="!inThread"
        :to="`/m/chat/c/${m.channelId}/t/${m.id}`"
        :aria-label="tx('reply')"
        class="p-1"
        ><MessageSquare :size="14"
      /></RouterLink>
      <template v-if="mine">
        <button type="button" :aria-label="tx('edit')" class="p-1" @click="startEdit">
          <Pencil :size="14" />
        </button>
        <button type="button" :aria-label="tx('delete')" class="p-1" @click="remove">
          <Trash2 :size="14" />
        </button>
      </template>
    </div>
  </article>
</template>
