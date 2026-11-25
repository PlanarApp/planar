<script setup lang="ts">
import { AlarmClock, Calendar } from 'lucide-vue-next';
import { computed, defineAsyncComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../../ui';
import DatesValue from './DatesValue.vue';
import LazyPopover from './LazyPopover.vue';

// Task dates in one compact field (PLNRAPP-208): start and due date (the due date is the end of the period).
// Nothing — the icon only; a period — "12 Nov – 19 Nov", each date in its color; only a due date — "⏰ 20 Nov".
// taskId / taskIds (bulk) — «My day» choices on top, as in DueDatePicker (PLNRAPP-137); #value — the List cell's own value.
const props = defineProps<{ taskId?: string; taskIds?: readonly string[] }>();
const dayIds = computed(() => props.taskIds ?? (props.taskId ? [props.taskId] : []));
// async: inbox imports tasks
const DayOptions = defineAsyncComponent(() => import('../../inbox/DayOptions.vue'));
const start = defineModel<string | null>('start', { default: null });
const due = defineModel<string | null>('due', { default: null });
// optional time of day 'HH:MM' for each date (only with the date)
const startTime = defineModel<string | null>('startTime', { default: null });
const dueTime = defineModel<string | null>('dueTime', { default: null });
// remind before the due time, minutes (0 — only at the due time); empty — the default 10
const dueRemindMin = defineModel<number | null>('dueRemindMin', { default: null });
const REMIND = [0, 5, 10, 15, 30, 60, 1440];
const { t } = useI18n();
const open = defineModel<boolean>('open', { default: false });
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
        class="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-fg outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        data-testid="task-dates"
      >
        <slot name="value">
          <Calendar :size="14" aria-hidden="true" />
          <AlarmClock
            v-if="due && !start"
            :size="14"
            aria-hidden="true"
            data-testid="task-dates-due"
          />
          <DatesValue :start="start" :due="due" :start-time="startTime" :due-time="dueTime" />
        </slot>
      </button>
    </template>
    <div class="flex w-full flex-col gap-2 md:w-56">
      <DayOptions v-if="dayIds.length" :task-ids="dayIds" @done="open = false" />
      <Input
        :model-value="start ?? ''"
        type="date"
        size="sm"
        :label="t('task.startDate')"
        @update:model-value="(v: string) => (start = v || null)"
      />
      <Input
        v-if="start"
        :model-value="startTime ?? ''"
        type="time"
        size="sm"
        :label="t('task.startTime')"
        data-testid="task-start-time"
        @update:model-value="(v: string) => (startTime = v || null)"
      />
      <Input
        :model-value="due ?? ''"
        type="date"
        size="sm"
        :label="t('tasks.dueDate')"
        @update:model-value="(v: string) => (due = v || null)"
      />
      <Input
        v-if="due"
        :model-value="dueTime ?? ''"
        type="time"
        size="sm"
        :label="t('task.dueTime')"
        data-testid="task-due-time"
        @update:model-value="(v: string) => (dueTime = v || null)"
      />
      <label v-if="due && dueTime" class="flex flex-col gap-1 text-sm text-fg-muted">
        {{ t('task.remindBefore') }}
        <select
          :value="dueRemindMin ?? 10"
          class="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus-visible:ring-2 ring-focus"
          data-testid="task-due-remind"
          @change="dueRemindMin = Number(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="m in REMIND" :key="m" :value="m">{{ t(`task.remind.${m}`) }}</option>
        </select>
      </label>
      <Button v-if="start || due" size="sm" variant="ghost" @click="clear">{{
        t('tasks.clear')
      }}</Button>
    </div>
  </LazyPopover>
</template>
