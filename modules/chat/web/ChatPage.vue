<script setup lang="ts">
import { computed, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ArrowLeft, MessageSquare } from 'lucide-vue-next';
import { EmptyState, db, groupUrl, useBreakpoint, useMembers, useQuery } from '@planar/web/modules';
import ChannelView from './ChannelView.vue';
import Section from './Section.vue';
import ThreadPanel from './ThreadPanel.vue';
import { useChatData } from './data';
import { dmTitle, isDirect } from './model';
import { useTexts } from './text';

const tx = useTexts();
const route = useRoute();
const router = useRouter();
const { isMobile } = useBreakpoint();
const { d, meId, users, readOf } = useChatData();
const channelId = computed(() => route.params.channelId as string | undefined);
const messageId = computed(() => route.params.messageId as string | undefined);
const rootId = computed(() => route.params.rootId as string | undefined);
const channel = computed(() => d.value?.channels.find((c) => c.id === channelId.value));

// старые адреса (уведомления, пуши, ссылки) — во вкладку «Чаты» группы канала: проект, пространство или
// Воркспейс (личные диалоги и корневое «Общее»); не нашли канал — остаёмся здесь
const rootSpace = useQuery(async () => {
  const v = ((await db.table('settings').get('root_space')) as { value?: unknown } | undefined)
    ?.value;
  return typeof v === 'string' ? v : null;
});
watch(
  () => [d.value, rootSpace.value, channelId.value] as const,
  ([x, root, id]) => {
    if (!x || root === undefined) return;
    if (!id) return void router.replace('/w/chats');
    const c = x.channels.find((y) => y.id === id);
    if (!c) return;
    const base = c.projectId
      ? groupUrl('project', c.projectId, 'chats')
      : c.spaceId && c.spaceId !== root
        ? groupUrl('space', c.spaceId, 'chats')
        : groupUrl('workspace', '', 'chats');
    void router.replace({
      path: base,
      query: {
        c: c.id,
        ...(rootId.value && { t: rootId.value }),
        ...(messageId.value && { m: messageId.value }),
      },
    });
  },
  { immediate: true },
);

// desktop: /m/chat/ открывает самый свежий канал или диалог
watch(
  () => [d.value, channelId.value, isMobile.value] as const,
  ([x, id, mobile]) => {
    if (!x || id || mobile) return;
    const last = [...x.channels]
      .filter((c) => !c.archivedAt)
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))[0];
    if (last) void router.replace(`/m/chat/c/${last.id}`);
  },
  { immediate: true },
);

const spaceMembers = useMembers(() => channel.value?.spaceId ?? '');
const members = computed(() =>
  channel.value?.spaceId
    ? (spaceMembers.value ?? [])
    : (d.value?.members ?? [])
        .filter((m) => m.channelId === channelId.value)
        .flatMap((m) => users.value.get(m.userId) ?? []),
);
// @-упоминания — в каналах и группах от трёх; в диалоге 1:1 их нет
const mentionable = computed(() =>
  channel.value && d.value && isDirect(channel.value, d.value.members) ? [] : members.value,
);
const title = computed(() => {
  const c = channel.value;
  if (!c) return '';
  return c.kind === 'dm' ? dmTitle(c, d.value!.members, users.value, meId.value) : `# ${c.name}`;
});
const showFeed = computed(() => !(isMobile.value && rootId.value));
</script>

<template>
  <div class="flex h-full min-h-0 flex-1" data-testid="chat-page">
    <div v-if="!channelId && isMobile" class="flex-1 overflow-y-auto p-2"><Section /></div>
    <EmptyState v-else-if="!channel" :icon="MessageSquare" :title="tx('empty')" class="m-auto" />
    <template v-else>
      <div v-if="showFeed" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="flex h-10 items-center gap-2 border-b border-border px-3">
          <RouterLink v-if="isMobile" to="/m/chat/" :aria-label="tx('back')"
            ><ArrowLeft :size="18"
          /></RouterLink>
          <h1 class="truncate text-sm font-medium" data-testid="chat-title">{{ title }}</h1>
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
          :members="mentionable"
          :message-id="messageId"
        />
      </div>
      <ThreadPanel
        v-if="rootId"
        :key="rootId"
        :channel-id="channel.id"
        :root-id="rootId"
        :users="users"
        :me="meId"
        :members="mentionable"
        :archived="!!channel.archivedAt"
      />
    </template>
  </div>
</template>
