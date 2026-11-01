<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  Archive,
  ChevronLeft,
  Hash,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-vue-next';
import {
  Badge,
  Button,
  favorites,
  i18n,
  ConfirmDialog,
  Dialog,
  EmptyState,
  FavStar,
  IconButton,
  Input,
  Menu,
  type MenuItem,
  Popover,
  mutate,
  newId,
  useGroupLevels,
  useMembers,
  type GroupScope,
} from '@planar/web/modules';
import ChannelView from './ChannelView.vue';
import ThreadPanel from './ThreadPanel.vue';
import { ensureDm, useChatData } from './data';
import { provideChatLinks } from './links';
import { byName, dmTitle, isDirect } from './model';
import { useTexts } from './text';

// «Chats» tab of the group: channels of its level and nested ones, personal dialogs — at the Workspace; channel — ?c, thread — ?t
const props = defineProps<{ scope: GroupScope }>();
const tx = useTexts();
const route = useRoute();
const router = useRouter();
const { d, meId, users, readOf, unreadOf, attentionOf } = useChatData();
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
      // nested levels without channels are not shown; our own is always shown (it has the «+»)
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
// @-mentions — in channels and groups of three or more; in a 1:1 chat there are none
const mentionable = computed(() =>
  channel.value && d.value && isDirect(channel.value, d.value.members) ? [] : members.value,
);
const fav = computed(() => !!channel.value && favorites.has('chat', channel.value.id));
const title = computed(() => {
  const c = channel.value;
  if (!c) return '';
  return c.kind === 'dm' ? dmTitle(c, d.value!.members, users.value, meId.value) : `# ${c.name}`;
});
// personal chat: 1–7 colleagues (visible by permissions — replica users); the same set — open the existing one
const picking = ref(false);
const picked = ref<string[]>([]);
const people = computed(() =>
  [...users.value.values()]
    .filter((u) => u.id !== meId.value && !u.deactivatedAt)
    .sort((a, b) => byName(a.name, b.name)),
);
const togglePick = (id: string) =>
  (picked.value = picked.value.includes(id)
    ? picked.value.filter((x) => x !== id)
    : picked.value.length < 7
      ? [...picked.value, id]
      : picked.value);
async function openDm() {
  const x = d.value;
  if (!x || !picked.value.length) return;
  const id = await ensureDm(x.channels, x.members, [meId.value, ...picked.value]);
  picking.value = false;
  picked.value = [];
  void router.push(links.channel(id));
}

// chat members: all participants see them; anyone can add (up to 8), only the chat creator can remove
const dmPeople = computed(() =>
  channel.value?.kind === 'dm'
    ? (d.value?.members ?? [])
        .filter((m) => m.channelId === channel.value!.id)
        .flatMap((m) => users.value.get(m.userId) ?? [])
        .sort((a, b) => byName(a.name, b.name))
    : [],
);
const ownDm = computed(() => channel.value?.createdBy === meId.value);
const addable = computed(() =>
  dmPeople.value.length >= 8
    ? []
    : people.value.filter((u) => !dmPeople.value.some((p) => p.id === u.id)),
);
const addToDm = (userId: string) =>
  void mutate('chat.dm.addMember', { id: newId(), channelId: channel.value!.id, userId });
const removeFromDm = (userId: string) =>
  void mutate('chat.dm.removeMember', { channelId: channel.value!.id, userId });

// channel settings: the creator or a space admin — name, topic, archive, delete
const canManage = computed(() => {
  const c = channel.value;
  if (!c || c.kind !== 'channel') return false;
  const role = d.value?.spaceMembers.find(
    (m) => m.spaceId === c.spaceId && m.userId === meId.value,
  )?.role;
  return c.createdBy === meId.value || role === 'admin';
});
const editOpen = ref(false);
const deleting = ref(false);
const form = ref({ name: '', topic: '' });
const channelMenu = computed<MenuItem[]>(() => {
  const c = channel.value!;
  return [
    {
      id: 'edit',
      label: tx('settings'),
      icon: Pencil,
      onSelect: () => {
        form.value = { name: c.name ?? '', topic: c.topic ?? '' };
        editOpen.value = true;
      },
    },
    {
      id: 'archive',
      label: c.archivedAt ? tx('unarchive') : tx('archive'),
      icon: Archive,
      onSelect: () =>
        void mutate('chat.channel.update', {
          id: c.id,
          archivedAt: c.archivedAt ? null : new Date().toISOString(),
        }),
    },
    { separator: true },
    {
      id: 'delete',
      label: tx('deleteChannel'),
      icon: Trash2,
      danger: true,
      onSelect: () => (deleting.value = true),
    },
  ];
});
async function saveChannel() {
  const c = channel.value;
  if (!c || !form.value.name.trim()) return;
  await mutate('chat.channel.update', {
    id: c.id,
    name: form.value.name.trim(),
    topic: form.value.topic.trim() || null,
  });
  editOpen.value = false;
}
async function removeChannel() {
  const c = channel.value;
  if (!c) return;
  deleting.value = false;
  await mutate('chat.channel.delete', { id: c.id });
  void router.push({ query: { ...route.query, c: undefined, t: undefined } });
}

const row =
  'flex h-7 max-md:h-10 items-center justify-between gap-1.5 rounded-md pl-6 pr-2 text-sm hover:bg-bg-muted';
const hoverPlus = 'ml-auto md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100';
</script>

<template>
  <div class="flex h-full min-h-0" data-testid="group-chats">
    <!-- мобильная: без выбранного чата — список на весь экран, с выбранным — чат и «назад» к списку -->
    <nav
      :aria-label="tx('chat')"
      :class="[
        'w-64 shrink-0 overflow-y-auto border-r border-border py-2',
        channel ? 'max-md:hidden' : 'max-md:w-full max-md:border-r-0',
      ]"
      data-testid="chat-nav"
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
          data-testid="chat-channel"
          :class="[row, q('c') === c.id && 'bg-accent-subtle']"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <Hash :size="14" class="shrink-0 text-fg-subtle" /><span
              :class="['truncate', unreadOf(c) > 0 && 'font-semibold']"
              >{{ c.name }}</span
            >
          </span>
          <Badge
            v-if="attentionOf(c) > 0"
            data-testid="chat-attention"
            variant="solid"
            color="var(--color-accent)"
            class="text-accent-fg!"
            >{{ attentionOf(c) }}</Badge
          >
          <span
            v-else-if="unreadOf(c) > 0"
            data-testid="chat-unread-dot"
            :aria-label="tx('unreadMark')"
            class="size-2 shrink-0 rounded-full bg-accent"
          />
        </RouterLink>
      </div>
      <div v-if="scope.level === 'workspace'" class="mt-2">
        <div class="group flex h-7 items-center pl-4 pr-2 text-xs text-fg-muted">
          <span>{{ tx('dms') }}</span>
          <IconButton
            :icon="Plus"
            :label="tx('newDm')"
            size="sm"
            :class="hoverPlus"
            data-testid="chat-add-dm"
            @click="picking = !picking"
          />
        </div>
        <form
          v-if="picking"
          class="flex max-h-64 flex-col gap-1 overflow-y-auto px-3 py-1"
          data-testid="chat-dm-picker"
          @submit.prevent="openDm"
        >
          <label v-for="u in people" :key="u.id" class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="picked.includes(u.id)"
              :data-testid="`chat-pick-${u.id}`"
              @change="togglePick(u.id)"
            />
            {{ u.name }}
          </label>
          <Button type="submit" size="sm" variant="primary" :disabled="!picked.length">{{
            tx('create')
          }}</Button>
        </form>
        <RouterLink
          v-for="x in dms"
          :key="x.c.id"
          :to="links.channel(x.c.id)"
          data-testid="chat-dm"
          :class="[row, q('c') === x.c.id && 'bg-accent-subtle']"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <User :size="14" class="shrink-0 text-fg-subtle" /><span
              :class="['truncate', unreadOf(x.c) > 0 && 'font-semibold']"
              >{{ x.title }}</span
            >
          </span>
          <Badge
            v-if="attentionOf(x.c) > 0"
            data-testid="chat-attention"
            variant="solid"
            color="var(--color-accent)"
            class="text-accent-fg!"
            >{{ attentionOf(x.c) }}</Badge
          >
          <span
            v-else-if="unreadOf(x.c) > 0"
            data-testid="chat-unread-dot"
            :aria-label="tx('unreadMark')"
            class="size-2 shrink-0 rounded-full bg-accent"
          />
        </RouterLink>
      </div>
    </nav>
    <EmptyState
      v-if="!channel"
      :icon="MessageSquare"
      :title="tx('empty')"
      class="m-auto max-md:hidden"
    />
    <template v-else>
      <!-- мобильная: открытый тред — на весь экран вместо канала (иначе два поля ввода) -->
      <div :class="['flex min-h-0 min-w-0 flex-1 flex-col', q('t') && 'max-md:hidden']">
        <header class="flex h-10 items-center gap-2 border-b border-border px-3">
          <RouterLink
            :to="{ query: { ...route.query, c: undefined, t: undefined } }"
            :aria-label="tx('chat')"
            class="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted md:hidden"
            data-testid="chat-back"
            ><ChevronLeft :size="18" aria-hidden="true"
          /></RouterLink>
          <h2 class="truncate text-sm font-medium" data-testid="chat-title">{{ title }}</h2>
          <span v-if="channel.topic" class="truncate text-xs text-fg-muted">{{
            channel.topic
          }}</span>
          <span v-if="channel.archivedAt" class="text-xs text-fg-subtle">{{ tx('archived') }}</span>
          <Popover v-if="channel.kind === 'dm'" align="end">
            <template #trigger>
              <Button
                size="sm"
                variant="ghost"
                :icon="Users"
                class="ml-auto"
                data-testid="chat-dm-members"
                >{{ dmPeople.length }}</Button
              >
            </template>
            <div class="flex w-64 flex-col gap-1" data-testid="chat-dm-members-panel">
              <p class="text-xs font-medium text-fg-muted">{{ tx('members') }}</p>
              <div
                v-for="u in dmPeople"
                :key="u.id"
                class="flex min-h-8 items-center gap-2 text-sm"
                data-testid="chat-dm-member"
              >
                <span class="min-w-0 flex-1 truncate">{{ u.name }}</span>
                <IconButton
                  v-if="ownDm && u.id !== meId && dmPeople.length > 2"
                  :icon="X"
                  size="sm"
                  :label="tx('removeMember', { name: u.name })"
                  @click="removeFromDm(u.id)"
                />
              </div>
              <template v-if="addable.length">
                <p class="mt-2 text-xs font-medium text-fg-muted">{{ tx('addMember') }}</p>
                <div class="flex max-h-48 flex-col overflow-y-auto">
                  <button
                    v-for="u in addable"
                    :key="u.id"
                    type="button"
                    class="flex min-h-8 items-center gap-2 rounded px-1 text-left text-sm hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
                    :data-testid="`chat-dm-add-${u.id}`"
                    @click="addToDm(u.id)"
                  >
                    <UserPlus :size="14" class="shrink-0 text-fg-subtle" />{{ u.name }}
                  </button>
                </div>
              </template>
            </div>
          </Popover>
          <!-- избранное — любому участнику (меню канала — только управляющим) -->
          <FavStar
            :fav="fav"
            :class="channel.kind !== 'dm' && 'ml-auto'"
            data-testid="chat-favorite"
            @click="
              favorites.toggle({ kind: 'chat', id: channel.id, name: title, to: route.fullPath })
            "
          />
          <Menu v-if="canManage" :items="channelMenu" align="end">
            <template #trigger>
              <IconButton
                :icon="MoreHorizontal"
                :label="tx('channelMenu')"
                size="sm"
                data-testid="chat-channel-menu"
              />
            </template>
          </Menu>
        </header>
        <Dialog v-model:open="editOpen" :title="tx('settings')" size="sm">
          <form class="flex flex-col gap-3" @submit.prevent="saveChannel">
            <Input v-model="form.name" :label="tx('channelName')" data-testid="chat-edit-name" />
            <Input v-model="form.topic" :label="tx('topic')" />
          </form>
          <template #footer>
            <Button variant="ghost" @click="editOpen = false">{{ tx('cancel') }}</Button>
            <Button variant="primary" data-testid="chat-edit-save" @click="saveChannel">{{
              tx('save')
            }}</Button>
          </template>
        </Dialog>
        <ConfirmDialog
          v-model:open="deleting"
          :title="tx('deleteChannelTitle', { name: channel.name ?? '' })"
          :description="tx('deleteChannelHint')"
          :confirm-label="tx('deleteChannel')"
          danger
          @confirm="removeChannel"
        />
        <ChannelView
          :key="channel.id"
          :channel="channel"
          :users="users"
          :me="meId"
          :read-seq="readOf.get(channel.id)?.lastReadSeq ?? 0"
          :members="mentionable"
          :message-id="q('m')"
        />
      </div>
      <ThreadPanel
        v-if="q('t')"
        :key="q('t')"
        :channel-id="channel.id"
        :root-id="q('t')!"
        :users="users"
        :me="meId"
        :members="mentionable"
        :archived="!!channel.archivedAt"
      />
    </template>
  </div>
</template>
