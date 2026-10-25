<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { Hash, MessageSquare, Plus, User } from 'lucide-vue-next';
import {
  Badge,
  EmptyState,
  IconButton,
  Input,
  mutate,
  newId,
  useGroupLevels,
  useMembers,
  type GroupScope,
} from '@planar/web/modules';
import ChannelView from './ChannelView.vue';
import ThreadPanel from './ThreadPanel.vue';
import { useChatData } from './data';
import { provideChatLinks } from './links';
import { byName, dmTitle } from './model';
import { useTexts } from './text';

// таб «Чаты» группы: каналы её уровня и вложенных, личные диалоги — у Воркспейса; канал — ?c, тред — ?t
const props = defineProps<{ scope: GroupScope }>();
const tx = useTexts();
const route = useRoute();
const router = useRouter();
const { d, meId, users, readOf, unreadOf } = useChatData();
const levels = useGroupLevels(() => props.scope);
const q = (k: string) =>
  typeof route.query[k] === 'string' ? (route.query[k] as string) : undefined;
const links = {
  channel: (c: string) => ({ query: { ...route.query, c, t: undefined } }),
  thread: (c: string, t: string) => ({ query: { ...route.query, c, t } }),
};
provideChatLinks(links);

const sections = computed(() => {
  const x = d.value;
  if (!x) return [];
  return (
    levels.value
      .map((l, i) => ({
        l,
        own: i === 0,
        canCreate: x.spaceMembers.some(
          (m) => m.spaceId === l.spaceId && m.userId === meId.value && m.role !== 'guest',
        ),
        items: x.channels
          .filter(
            (c) =>
              c.kind === 'channel' &&
              c.spaceId === l.spaceId &&
              (c.projectId ?? null) === l.projectId &&
              !c.archivedAt,
          )
          .sort((a, b) => byName(a.name ?? '', b.name ?? '')),
      }))
      // вложенные уровни без каналов не показываем; свой — всегда (там «+»)
      .filter((s) => s.own || s.items.length)
  );
});
const dms = computed(() => {
  const x = d.value;
  if (!x || props.scope.level !== 'workspace') return [];
  return x.channels
    .filter((c) => c.kind === 'dm' && !c.archivedAt)
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
    .map((c) => ({ c, title: dmTitle(c, x.members, users.value, meId.value) }));
});

const addIn = ref('');
const name = ref('');
async function addChannel(spaceId: string, projectId: string | null) {
  const n = name.value.trim();
  if (!n) return;
  const id = newId();
  await mutate('chat.channel.create', { id, spaceId, projectId, name: n });
  addIn.value = name.value = '';
  void router.push(links.channel(id));
}

const channel = computed(() => d.value?.channels.find((c) => c.id === q('c')));
const spaceMembers = useMembers(() => channel.value?.spaceId ?? '');
const members = computed(() =>
  channel.value?.spaceId
    ? (spaceMembers.value ?? [])
    : (d.value?.members ?? [])
        .filter((m) => m.channelId === channel.value?.id)
        .flatMap((m) => users.value.get(m.userId) ?? []),
);
const title = computed(() => {
  const c = channel.value;
  if (!c) return '';
  return c.kind === 'dm' ? dmTitle(c, d.value!.members, users.value, meId.value) : `# ${c.name}`;
});
const row =
  'flex h-7 items-center justify-between gap-1.5 rounded-md pl-6 pr-2 text-sm hover:bg-bg-muted';
const hoverPlus = 'ml-auto md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100';
</script>

<template>
  <div class="flex h-full min-h-0" data-testid="group-chats">
    <nav
      :aria-label="tx('chat')"
      class="w-64 shrink-0 overflow-y-auto border-r border-border py-2 max-md:hidden"
    >
      <div v-for="s in sections" :key="s.l.key" class="mb-1">
        <div
          :class="[
            'group flex h-7 items-center pr-2 text-xs text-fg-muted',
            s.l.level === 'project' && scope.level !== 'project' ? 'pl-8' : 'pl-4',
          ]"
        >
          <span class="truncate">{{ s.l.title }}</span>
          <IconButton
            v-if="s.canCreate"
            :icon="Plus"
            :label="tx('newChannel')"
            size="sm"
            :class="hoverPlus"
            @click="addIn = s.l.key"
          />
        </div>
        <form
          v-if="addIn === s.l.key"
          class="px-2 py-1"
          @submit.prevent="addChannel(s.l.spaceId, s.l.projectId)"
        >
          <Input
            v-model="name"
            :label="tx('channelName')"
            hide-label
            :placeholder="tx('channelName')"
            autofocus
            @keydown.esc="addIn = ''"
          />
        </form>
        <RouterLink
          v-for="c in s.items"
          :key="c.id"
          :to="links.channel(c.id)"
          :class="[row, q('c') === c.id && 'bg-accent-subtle']"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <Hash :size="14" class="shrink-0 text-fg-subtle" /><span class="truncate">{{
              c.name
            }}</span>
          </span>
          <Badge
            v-if="unreadOf(c) > 0"
            variant="solid"
            color="var(--color-accent)"
            class="text-accent-fg!"
            >{{ unreadOf(c) }}</Badge
          >
        </RouterLink>
      </div>
      <div v-if="dms.length" class="mt-2">
        <div class="flex h-7 items-center pl-4 text-xs text-fg-muted">{{ tx('dms') }}</div>
        <RouterLink
          v-for="x in dms"
          :key="x.c.id"
          :to="links.channel(x.c.id)"
          :class="[row, q('c') === x.c.id && 'bg-accent-subtle']"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <User :size="14" class="shrink-0 text-fg-subtle" /><span class="truncate">{{
              x.title
            }}</span>
          </span>
          <Badge
            v-if="unreadOf(x.c) > 0"
            variant="solid"
            color="var(--color-accent)"
            class="text-accent-fg!"
            >{{ unreadOf(x.c) }}</Badge
          >
        </RouterLink>
      </div>
    </nav>
    <EmptyState v-if="!channel" :icon="MessageSquare" :title="tx('empty')" class="m-auto" />
    <template v-else>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="flex h-10 items-center gap-2 border-b border-border px-3">
          <h2 class="truncate text-sm font-medium" data-testid="chat-title">{{ title }}</h2>
          <span v-if="channel.topic" class="truncate text-xs text-fg-muted">{{
            channel.topic
          }}</span>
        </header>
        <ChannelView
          :key="channel.id"
          :channel="channel"
          :users="users"
          :me="meId"
          :read-seq="readOf.get(channel.id)?.lastReadSeq ?? 0"
          :members="members"
          :message-id="undefined"
        />
      </div>
      <ThreadPanel
        v-if="q('t')"
        :key="q('t')"
        :channel-id="channel.id"
        :root-id="q('t')!"
        :users="users"
        :me="meId"
        :members="members"
        :archived="!!channel.archivedAt"
      />
    </template>
  </div>
</template>
