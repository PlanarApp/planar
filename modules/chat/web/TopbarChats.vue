<script setup lang="ts">
import { computed, ref } from 'vue';
import { MessageSquare } from 'lucide-vue-next';
import {
  Badge,
  EmptyState,
  IconButton,
  Popover,
  Tabs,
  useRouter,
  useSpaces,
} from '@planar/web/modules';
import { useChatData } from './data';
import { dmTitle } from './model';
import { useTexts } from './text';

// кнопка чатов в верхней панели: счётчик непрочитанных, в меню — каналы и диалоги (непрочитанные / все)
const { d, meId, users, unreadOf, attentionOf, total } = useChatData();
const router = useRouter();
const tr = useTexts();
const spaces = useSpaces();
// место в структуре: «Пространство › Проект»; диалоги — «Личные»
const where = (spaceId: string | null, projectId: string | null) => {
  const sp = (spaces.value ?? []).find((x) => x.id === spaceId);
  if (!sp) return tr('dms');
  const p = sp.projects.find((x) => x.id === projectId);
  return p ? `${sp.name} › ${p.name}` : sp.name;
};
const open = ref(false);
const filter = ref<'unread' | 'all'>('unread');
const rows = computed(() => {
  const x = d.value;
  if (!x) return [];
  const mine = new Set(x.members.filter((m) => m.userId === meId.value).map((m) => m.channelId));
  return x.channels
    .filter((c) => !c.archivedAt && (c.kind === 'channel' || mine.has(c.id)))
    .filter((c) => filter.value === 'all' || unreadOf(c) > 0)
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
    .map((c) => ({
      c,
      n: attentionOf(c),
      unread: unreadOf(c) > 0,
      where: where(c.spaceId, c.projectId),
      title:
        c.kind === 'dm'
          ? dmTitle(c, x.members, users.value, meId.value) ||
            (users.value.get(meId.value)?.name ?? tr('unknown'))
          : `# ${c.name}`,
    }));
});
// /m/chat/c/<id> сам ведёт в таб «Чаты» нужной группы
const go = (c: string) => {
  open.value = false;
  void router.push(`/m/chat/c/${c}`);
};
</script>

<template>
  <Popover v-model:open="open" align="end">
    <template #trigger>
      <span class="relative">
        <IconButton :icon="MessageSquare" :label="tr('chat')" data-testid="topbar-chats" />
        <span
          v-if="total"
          data-testid="chats-count"
          class="pointer-events-none absolute right-0 top-0 min-w-4 rounded-full bg-accent px-1 text-center text-2xs text-accent-fg"
          >{{ total }}</span
        >
      </span>
    </template>
    <div class="flex w-72 flex-col gap-2" data-testid="topbar-chats-menu">
      <Tabs
        v-model="filter"
        :label="tr('chat')"
        :items="[
          { value: 'unread', label: tr('unreadOnly') },
          { value: 'all', label: tr('allChats') },
        ]"
      />
      <EmptyState
        v-if="!rows.length"
        :title="tr(filter === 'unread' ? 'noUnread' : 'noChannels')"
      />
      <div class="flex max-h-80 flex-col overflow-y-auto">
        <button
          v-for="r in rows"
          :key="r.c.id"
          type="button"
          data-testid="topbar-chat"
          class="flex min-h-11 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
          @click="go(r.c.id)"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span :class="['truncate', r.unread && 'font-semibold']">{{ r.title }}</span>
            <span class="truncate text-xs text-fg-subtle" data-testid="topbar-chat-where">{{
              r.where
            }}</span>
          </span>
          <Badge v-if="r.n" variant="solid" color="var(--color-accent)" class="text-accent-fg!">{{
            r.n
          }}</Badge>
          <span v-else-if="r.unread" class="size-2 shrink-0 rounded-full bg-accent" />
        </button>
      </div>
    </div>
  </Popover>
</template>
