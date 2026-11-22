<script setup lang="ts">
import { AlarmClock, Calendar } from 'lucide-vue-next';
import { computed, defineAsyncComponent, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../../ui';
import { formatDue, formatPeriod } from '../../views/list/due';
import { localToday } from '../../views/filter';
import LazyPopover from './LazyPopover.vue';

// Task dates in one compact field (PLNRAPP-208): start and due date (the due date is the end of the period).
// Nothing — the icon only; a period — "12–19 Nov"; only a due date — "⏰ 20 Nov"; overdue — danger.
// taskId — «My day» choices on top, as in DueDatePicker (PLNRAPP-137).
const props = defineProps<{ taskId?: string }>();
// async: inbox imports tasks
const DayOptions = defineAsyncComponent(() => import('../../inbox/DayOptions.vue'));
const start = defineModel<string | null>('start', { default: null });
const due = defineModel<string | null>('due', { default: null });
const { t, locale } = useI18n();
const open = ref(false);
const overdue = computed(() => !!due.value && due.value < localToday());
const text = computed(() =>
  start.value && !due.value
    ? t('task.fromDate', { date: formatDue(start.value, locale.value) })
    : start.value
      ? formatPeriod(start.value, due.value, locale.value)
      : due.value
        ? formatDue(due.value, locale.value)
        : '',
);
const clear = () => {
  if (start.value) start.value = null;
  if (due.value) due.value = null;
  open.value = false;
};
</script>

<template>
  <LazyPopover v-model:open="open" align="start">
    <template #trigger="{ attrs }">
      <button
        v-bind="attrs"
        type="button"
        :aria-label="t('task.dates')"
        :class="[
          'inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus',
          overdue ? 'text-danger' : 'text-fg',
        ]"
        data-testid="task-dates"
      >
        <Calendar :size="14" aria-hidden="true" />
        <AlarmClock
          v-if="due && !start"
          :size="14"
          aria-hidden="true"
          data-testid="task-dates-due"
        />
        <span v-if="text" data-testid="task-dates-value">{{ text }}</span>
      </button>
    </template>
    <div class="flex w-56 flex-col gap-2">
      <DayOptions v-if="props.taskId" :task-id="props.taskId" @done="open = false" />
      <Input
        :model-value="start ?? ''"
        type="date"
        size="sm"
        :label="t('task.startDate')"
        @update:model-value="(v: string) => (start = v || null)"
      />
      <Input
        :model-value="due ?? ''"
        type="date"
        size="sm"
        :label="t('tasks.dueDate')"
        @update:model-value="(v: string) => (due = v || null)"
      />
      <Button v-if="start || due" size="sm" variant="ghost" @click="clear">{{
        t('tasks.clear')
      }}</Button>
    </div>
  </LazyPopover>
</template>
