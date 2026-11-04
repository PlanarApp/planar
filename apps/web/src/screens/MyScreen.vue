<script setup lang="ts">
import { computed } from 'vue';
import { ListChecks, Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { StatusIcon } from '../tasks';
import { EmptyState, IconButton } from '../ui';
import { openTask } from '../views';
import TaskModal from '../views/TaskModal.vue';
import { formatDue } from '../views/list/due';
import { useAuth } from '../auth/useAuth';
import { useMyTasks, type MyTask, type WorkKind } from '../inbox/queries';
import { planToday, useMyDay } from '../inbox/myDay';
import MyDayPanel from '../inbox/MyDayPanel.vue';

const { t, locale } = useI18n();
// projectIds — the group's "My tasks" view (only its projects, without the screen header)
// kind — the "My work" list (assigned, created, watched); default — assigned
const props = defineProps<{ projectIds?: string[]; kind?: WorkKind }>();
const { user } = useAuth();
const all = useMyTasks(
  () => user.value?.id,
  () => props.kind ?? 'assigned',
);
const rows = computed(() => {
  const ids = props.projectIds && new Set(props.projectIds);
  return ids ? all.value?.filter((r) => ids.has(r.projectId)) : all.value;
});

// «My day» — only on the «My work» screen, not in a group's «My tasks»
const day = useMyDay(() => (props.projectIds ? undefined : user.value?.id));

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const groups = computed(() => {
  const now = new Date();
  const today = iso(now);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const week = iso(sunday);
  const order = ['overdue', 'today', 'week', 'later', 'none'];
  const g: Record<string, MyTask[]> = Object.fromEntries(order.map((k) => [k, []]));
  for (const r of rows.value ?? []) {
    const d = r.dueDate;
    g[
      !d ? 'none' : d < today ? 'overdue' : d === today ? 'today' : d <= week ? 'week' : 'later'
    ].push(r);
  }
  for (const k of order) g[k].sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1));
  return order.filter((k) => g[k].length).map((k) => ({ k, items: g[k] }));
});
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <h1 v-if="!projectIds" class="text-xl font-semibold">{{ t('screens.my') }}</h1>
    <MyDayPanel v-if="!projectIds && day" :day="day" />
    <EmptyState
      v-if="rows && !rows.length"
      :icon="ListChecks"
      :title="t('inbox.myEmpty')"
      :description="t('inbox.myEmptyHint')"
    />
    <section v-for="g in groups" :key="g.k" :data-group="g.k">
      <h2 class="mb-1 text-xs font-medium text-fg-muted">{{ t(`inbox.my.${g.k}`) }}</h2>
      <div v-for="r in g.items" :key="r.id" class="flex items-center gap-1">
        <button
          type="button"
          data-testid="my-row"
          class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
          @click="openTask(r.key)"
        >
          <StatusIcon :status="r.status" />
          <span class="text-xs text-fg-subtle">{{ r.key }}</span>
          <span class="flex-1 truncate">{{ r.title }}</span>
          <span v-if="r.dueDate" class="text-xs text-fg-muted">{{
            formatDue(r.dueDate, locale)
          }}</span>
          <span class="hidden text-xs text-fg-subtle md:inline">{{ r.project }}</span>
        </button>
        <IconButton
          v-if="day && !projectIds && !day.planned.has(r.id)"
          :icon="Plus"
          :label="t('myDay.add')"
          size="sm"
          data-testid="my-day-add"
          @click="planToday(r.id, day)"
        />
      </div>
    </section>
    <TaskModal />
  </div>
</template>
