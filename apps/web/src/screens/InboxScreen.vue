<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowRight, BellOff, Inbox, Trash2 } from 'lucide-vue-next';
import { Button, EmptyState, Menu, Tabs, useBreakpoint, type MenuItem } from '../ui';
import { router } from '../router';
import { mutate } from '../sync';
import { closeTask, openTask, taskPanelLoader } from '../views';
import PushToggle from '../inbox/PushToggle.vue';
import { groupByTask, inGroup, useNotifications, type InboxItem } from '../inbox/queries';
import type { GroupScope } from '../modules/types';
import { isSnoozed, snooze, snoozeUntil, snoozed, type SnoozeOption } from '../inbox/snooze';

// scope — таб «Входящие» группы: уведомления её уровня и вложенных
const props = defineProps<{ scope?: GroupScope }>();
const { t, locale } = useI18n();
const all = useNotifications();
const rows = computed(() =>
  props.scope ? all.value?.filter((n) => inGroup(n, props.scope!)) : all.value,
);
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
// день — по самому новому уведомлению карточки
const groups = computed(() => {
  const g: { day: string; cards: InboxItem[][] }[] = [];
  for (const c of groupByTask(visible.value)) {
    const d = day(c[0].createdAt);
    (g.at(-1)?.day === d ? g.at(-1)! : g[g.push({ day: d, cards: [] }) - 1]).cards.push(c);
  }
  return g;
});
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' });
// десктоп: справа форма задачи из ?task, как в ClickUp
const TaskPanel = taskPanelLoader && defineAsyncComponent(taskPanelLoader);
const selected = computed(() => {
  const q = router.currentRoute.value.query.task;
  return typeof q === 'string' ? q : '';
});
const split = computed(() => !!TaskPanel && !isMobile.value);
const unreadIds = computed(() => visible.value.filter((n) => !n.readAt).map((n) => n.id));

const read = (ids: string[]) => ids.length && mutate('notification.read', { ids });
const ids = (c: InboxItem[]) => c.map((n) => n.id);
// действия карточки — на все её уведомления
function open(c: InboxItem[]) {
  const n = c[0];
  void read(c.filter((x) => !x.readAt).map((x) => x.id));
  if (n.taskKey && split.value)
    void router.replace({ query: { ...router.currentRoute.value.query, task: n.taskKey } });
  else if (n.taskKey) openTask(n.taskKey);
  else if (n.url?.startsWith('/') && !/^\/[/\\]/.test(n.url)) void router.push(n.url);
}
const snoozeItems = (c: InboxItem[]): MenuItem[] =>
  (['3h', 'tomorrow', 'week'] as SnoozeOption[]).map((o) => ({
    id: o,
    label: t(`inbox.snooze.${o}`),
    onSelect: () => c.forEach((n) => snooze(n.id, snoozeUntil(o))),
  }));
const rowItems = (c: InboxItem[]): MenuItem[] => [
  ...snoozeItems(c),
  { separator: true },
  {
    id: 'delete',
    label: t('inbox.delete'),
    icon: Trash2,
    danger: true,
    onSelect: () => mutate('notification.delete', { ids: ids(c) }),
  },
];
</script>

<template>
  <div :class="split && 'flex h-full min-h-0'">
    <div
      class="flex flex-col gap-3 p-4"
      :class="split && 'w-[26rem] shrink-0 overflow-y-auto border-r border-border'"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h1 v-if="!scope" class="w-full text-xl font-semibold md:w-auto md:flex-1">
          {{ t('screens.inbox') }}
        </h1>
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
      <section v-for="g in groups" :key="g.day" class="flex flex-col gap-1">
        <h2 class="mb-1 text-xs font-medium text-fg-muted">{{ g.day }}</h2>
        <div
          v-for="c in g.cards"
          :key="c[0].id"
          data-testid="inbox-item"
          :data-unread="c.some((n) => !n.readAt) || undefined"
          class="group relative rounded-md border border-border hover:bg-bg-muted"
          :class="[
            c.some((n) => !n.readAt) && 'bg-accent-subtle',
            c[0].taskKey && c[0].taskKey === selected && 'ring-2 ring-focus',
          ]"
        >
          <button
            type="button"
            class="flex w-full min-w-0 flex-col gap-1 rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 ring-focus"
            @click="open(c)"
          >
            <span v-if="c[0].taskKey" class="flex min-w-0 items-center gap-2 pr-16">
              <span
                v-if="c.some((n) => !n.readAt)"
                class="size-2 shrink-0 rounded-full bg-accent"
                aria-hidden="true"
              />
              <span class="shrink-0 font-mono text-xs text-fg-muted">{{ c[0].taskKey }}</span>
              <span class="truncate font-medium">{{ c[0].taskTitle }}</span>
            </span>
            <span
              v-for="n in c.slice(0, 3)"
              :key="n.id"
              data-testid="inbox-change"
              class="flex min-w-0 flex-col gap-0.5 text-xs"
              :class="n.readAt ? 'text-fg-muted' : 'text-fg'"
            >
              <span class="flex flex-wrap items-center gap-1">
                {{ t(`inbox.kind.${n.kind}`, { who: n.actorName, key: n.taskKey ?? '?' }) }}
                <template v-if="n.status">
                  <span v-for="(s, i) in n.status" :key="i" class="contents">
                    <ArrowRight v-if="i" :size="12" aria-hidden="true" />
                    <span
                      class="rounded px-1.5 py-0.5 font-medium text-fg"
                      :style="{ background: `color-mix(in srgb, ${s.color} 16%, transparent)` }"
                      >{{ s.name }}</span
                    >
                  </span>
                </template>
                <span class="ml-auto shrink-0 text-fg-subtle">{{ time(n.createdAt) }}</span>
              </span>
              <span
                v-if="n.comment"
                class="line-clamp-2 border-l-2 border-border-strong pl-2 text-fg-muted"
                >{{ n.comment }}</span
              >
              <span v-else-if="!n.taskId && n.taskTitle" class="line-clamp-2 text-fg-muted">{{
                n.taskTitle
              }}</span>
            </span>
            <span v-if="c.length > 3" class="text-xs text-fg-subtle">
              {{ t('inbox.more', { n: c.length - 3 }) }}
            </span>
          </button>
          <Menu
            v-if="isMobile"
            class="absolute top-1 right-1"
            :items="rowItems(c)"
            :label="t('inbox.actions')"
            align="end"
          />
          <div
            v-else
            class="absolute top-1 right-1 flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <Menu :items="snoozeItems(c)" align="end">
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
              @click="mutate('notification.delete', { ids: ids(c) })"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </section>
    </div>
    <div v-if="split" class="min-w-0 flex-1">
      <component
        :is="TaskPanel"
        v-if="selected"
        :key="selected"
        :task-key="selected"
        mode="panel"
        @close="closeTask"
      />
      <EmptyState v-else :icon="Inbox" :title="t('inbox.pick')" />
    </div>
  </div>
</template>
