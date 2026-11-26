<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { CalendarClock, Sun } from '@lucide/vue';
import type { Row } from '@planar/shared';
import { Button } from '../ui';
import { db, useQuery } from '../sync';
import { localToday } from '../views/filter';
import { planFor } from './myDay';

// «My day» in the «Due date» menu of a task (PLNRAPP-137, PLNRAPP-864): due today / tomorrow, both always, the current
// one marked; no «remove from the day» — a task leaves the day only by a due date change (another date or «Clear»)
// several tasks (bulk selection): marked when all of them are due that day
const props = defineProps<{ taskIds: readonly string[] }>();
const emit = defineEmits<{ done: [] }>();
const { t } = useI18n();
const tasks = useQuery(() => db.table<Row<'tasks'>>('tasks').bulkGet([...props.taskIds]));
const on = (date: string) => !!tasks.value?.length && tasks.value.every((x) => x?.dueDate === date);
const to = (date: string) => {
  emit('done');
  for (const id of props.taskIds) void planFor(id, date);
};
</script>

<template>
  <div
    v-if="tasks?.length"
    class="flex flex-col border-b border-border pb-2"
    data-testid="day-options"
  >
    <Button
      size="sm"
      variant="ghost"
      class="justify-start"
      :class="on(localToday()) && 'bg-bg-muted'"
      :aria-pressed="on(localToday())"
      data-testid="day-options-today"
      @click="to(localToday())"
      ><Sun :size="14" aria-hidden="true" />{{ t('myDay.toToday') }}</Button
    >
    <Button
      size="sm"
      variant="ghost"
      class="justify-start"
      :class="on(localToday(1)) && 'bg-bg-muted'"
      :aria-pressed="on(localToday(1))"
      data-testid="day-options-tomorrow"
      @click="to(localToday(1))"
      ><CalendarClock :size="14" aria-hidden="true" />{{ t('myDay.toTomorrow') }}</Button
    >
  </div>
</template>
