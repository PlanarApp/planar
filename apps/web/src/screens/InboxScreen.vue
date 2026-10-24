<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { BellOff, Inbox, Trash2 } from 'lucide-vue-next';
import { Button, EmptyState, Menu, Tabs, useBreakpoint, type MenuItem } from '../ui';
import { router } from '../router';
import { mutate } from '../sync';
import { openTask } from '../views';
import PushToggle from '../inbox/PushToggle.vue';
import { useNotifications, type InboxItem } from '../inbox/queries';
import { isSnoozed, snooze, snoozeUntil, snoozed, type SnoozeOption } from '../inbox/snooze';

const { t, locale } = useI18n();
const rows = useNotifications();
const act = 'flex size-11 items-center justify-center rounded-md hover:bg-bg-muted md:size-8';
const filter = ref('all');
const onlyUnread = computed(() => filter.value === 'unread');
const { isMobile } = useBreakpoint();

const visible = computed(() =>
  (rows.value ?? []).filter(
    (n) => !(snoozed.value[n.id] && isSnoozed(n.id)) && (!onlyUnread.value || !n.readAt),
  ),
);
const day = (iso: string) => {
  const d = new Date(iso);
  const diff = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5,
  );
  if (diff === 0) return t('inbox.today');
  if (diff === 1) return t('inbox.yesterday');
  return d.toLocaleDateString(locale.value);
};
const groups = computed(() => {
  const g: { day: string; items: InboxItem[] }[] = [];
  for (const n of visible.value) {
    const d = day(n.createdAt);
    (g.at(-1)?.day === d ? g.at(-1)! : g[g.push({ day: d, items: [] }) - 1]).items.push(n);
  }
  return g;
});
const unreadIds = computed(() => visible.value.filter((n) => !n.readAt).map((n) => n.id));

const read = (ids: string[]) => ids.length && mutate('notification.read', { ids });
function open(n: InboxItem) {
  if (!n.readAt) void read([n.id]);
  if (n.taskKey) openTask(n.taskKey);
  else if (n.url?.startsWith('/') && !/^\/[/\\]/.test(n.url)) void router.push(n.url);
}
const snoozeItems = (n: InboxItem): MenuItem[] =>
  (['3h', 'tomorrow', 'week'] as SnoozeOption[]).map((o) => ({
    id: o,
    label: t(`inbox.snooze.${o}`),
    onSelect: () => snooze(n.id, snoozeUntil(o)),
  }));
const rowItems = (n: InboxItem): MenuItem[] => [
  ...snoozeItems(n),
  { separator: true },
  {
    id: 'delete',
    label: t('inbox.delete'),
    icon: Trash2,
    danger: true,
    onSelect: () => mutate('notification.delete', { ids: [n.id] }),
  },
];
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="w-full text-xl font-semibold md:w-auto md:flex-1">{{ t('screens.inbox') }}</h1>
      <Tabs
        v-model="filter"
        :label="t('inbox.filter')"
        :items="[
          { value: 'all', label: t('inbox.all') },
          { value: 'unread', label: t('inbox.onlyUnread') },
        ]"
      />
      <Button class="ml-auto" size="sm" :disabled="!unreadIds.length" @click="read(unreadIds)">
        {{ t('inbox.readAll') }}
      </Button>
    </div>
    <PushToggle />
    <EmptyState
      v-if="rows && !visible.length"
      :icon="Inbox"
      :title="t('inbox.empty')"
      :description="t('inbox.emptyHint')"
    />
    <section v-for="g in groups" :key="g.day">
      <h2 class="mb-1 text-xs font-medium text-fg-muted">{{ g.day }}</h2>
      <div
        v-for="n in g.items"
        :key="n.id"
        data-testid="inbox-item"
        :data-unread="!n.readAt || undefined"
        class="group flex items-center gap-1 rounded-md hover:bg-bg-muted"
        :class="n.readAt ? 'text-fg-muted' : 'bg-accent-subtle font-medium'"
      >
        <button
          type="button"
          class="min-h-11 min-w-0 flex-1 px-2 text-left md:min-h-8 md:truncate text-sm outline-none focus-visible:ring-2 ring-focus"
          @click="open(n)"
        >
          {{ t(`inbox.kind.${n.kind}`, { who: n.actorName, key: n.taskKey ?? '?' }) }}
          <span class="text-fg-subtle">{{ n.taskTitle }}</span>
        </button>
        <Menu v-if="isMobile" :items="rowItems(n)" :label="t('inbox.actions')" align="end" />
        <div v-else class="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <Menu :items="snoozeItems(n)" align="end">
            <template #trigger>
              <button type="button" :aria-label="t('inbox.snoozeLabel')" :class="act">
                <BellOff :size="16" />
              </button>
            </template>
          </Menu>
          <button
            type="button"
            :aria-label="t('inbox.delete')"
            :class="act"
            @click="mutate('notification.delete', { ids: [n.id] })"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
