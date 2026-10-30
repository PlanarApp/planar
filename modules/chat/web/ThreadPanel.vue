<script setup lang="ts">
import { useChatLinks } from './links';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';
import { X } from 'lucide-vue-next';
import { api, db, useQuery } from '@planar/web/modules';
import Composer from './Composer.vue';
import MessageItem from './MessageItem.vue';
import { bySeq, type Message, type Reaction, type UserRow } from './model';
import { useTexts } from './text';
import { useChannelReactions } from './feed';

const props = defineProps<{
  channelId: string;
  rootId: string;
  users: Map<string, UserRow>;
  me: string;
  members: { id: string; name: string }[];
  archived?: boolean;
}>();
const tx = useTexts();
const rest = shallowRef<{ root: Message; replies: Message[]; reactions: Reaction[] } | null>(null);
onMounted(async () => {
  rest.value = await api<{ root: Message; replies: Message[]; reactions: Reaction[] }>(
    'GET',
    `/api/chat/messages/${props.rootId}/thread`,
  ).catch(() => null);
});
const localRoot = useQuery(() => db.table<Message>('chatMessages').get(props.rootId));
const localReplies = useQuery(() =>
  db.table<Message>('chatMessages').where('parentId').equals(props.rootId).toArray(),
);
const merged = useChannelReactions(() => props.channelId);

const root = computed(() => localRoot.value ?? rest.value?.root);
const replies = computed(() => {
  const m = new Map<string, Message>();
  for (const r of rest.value?.replies ?? []) m.set(r.id, r);
  for (const r of localReplies.value ?? []) m.set(r.id, r);
  return [...m.values()].sort(bySeq);
});
const reactions = computed(() => merged(rest.value?.reactions ?? []));
const reactionsOf = (id: string) => reactions.value.filter((r) => r.messageId === id);
const links = useChatLinks();
// ↑ в пустом поле — правка своего последнего ответа
const composer = ref<InstanceType<typeof Composer> | null>(null);
const editId = ref('');
const editLast = () =>
  (editId.value =
    [...(replies.value ?? [])].reverse().find((r) => r.authorId === props.me && !r.deletedAt)?.id ??
    '');
function editDone() {
  editId.value = '';
  composer.value?.focus();
}
</script>

<template>
  <aside
    data-testid="chat-thread"
    class="flex min-h-0 w-full flex-col border-border md:w-96 md:border-l"
  >
    <header class="flex h-10 items-center justify-between border-b border-border px-3">
      <h2 class="text-sm font-medium">{{ tx('thread') }}</h2>
      <RouterLink :to="links.channel(channelId)" :aria-label="tx('close')"
        ><X :size="16"
      /></RouterLink>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <MessageItem
        v-if="root"
        :message="root"
        :reactions="reactionsOf(root.id)"
        :users="users"
        :me="me"
        :members="members"
        in-thread
      />
      <MessageItem
        v-for="r in replies"
        :key="r.id"
        :message="r"
        :reactions="reactionsOf(r.id)"
        :users="users"
        :me="me"
        :members="members"
        in-thread
        :edit="editId === r.id"
        @edit-done="editDone"
      />
    </div>
    <Composer
      ref="composer"
      :channel-id="channelId"
      :parent-id="rootId"
      :members="members"
      :disabled="archived"
      @edit-last="editLast"
    />
  </aside>
</template>
