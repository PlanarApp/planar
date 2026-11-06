<script setup lang="ts">
import { computed } from 'vue';
import { ListChecks, Plus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { StatusIcon } from '../tasks';
import { EmptyState, IconButton } from '../ui';
import { openTask } from '../views';
import { formatDue } from '../views/list/due';
import { useAuth } from '../auth/useAuth';
import { useMyTasks, type MyTask } from './queries';
import { dayIn, planToday, useMyDay } from './myDay';
import MyDayPanel from './MyDayPanel.vue';

// «My day» tab of «Assigned» in a group's «My work» (PLANARAPP-52, PLANARAPP-57; formerly the /my screen): the planner and my tasks
// by due date, only of the group's projects (with nested)
const props = defineProps<{ projectIds: string[] }>();
const { t, locale } = useI18n();
const { user } = useAuth();
const all = useMyTasks(
  () => user.value?.id,
  () => 'assigned',
);
const rows = computed(() => {
  const ids = new Set(props.projectIds);
  return all.value?.filter((r) => ids.has(r.projectId));
});

const day = useMyDay(() => user.value?.id);
const shown = computed(() => day.value && dayIn(day.value, props.projectIds));

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// only what is due now: overdue and today's (by due date or by plan — start today or earlier),
// then the tasks without a due date; later due dates are not shown (PLNRAPP-81)
const groups = computed(() => {
  const today = iso(new Date());
  const order = ['overdue', 'today', 'none'];
  const g: Record<string, MyTask[]> = Object.fromEntries(order.map((k) => [k, []]));
  for (const r of rows.value ?? []) {
    const d = r.dueDate;
    const started = !!r.startDate && r.startDate <= today;
    if (d && d < today) g.overdue!.push(r);
    else if (d === today || started) g.today!.push(r);
    else if (!d) g.none!.push(r);
  }
  for (const k of order) g[k].sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1));
  return order.filter((k) => g[k].length).map((k) => ({ k, items: g[k] }));
});
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <MyDayPanel v-if="shown" :day="shown" />
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
          v-if="day && !day.planned.has(r.id)"
          :icon="Plus"
          :label="t('myDay.add')"
          size="sm"
          data-testid="my-day-add"
          @click="planToday(r.id, day)"
        />
      </div>
    </section>
  </div>
</template>
