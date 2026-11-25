<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { CalendarClock, Sun } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { Button } from '../ui';
import { db, useQuery } from '../sync';
import { localToday } from '../views/filter';
import { planFor } from './myDay';

// «My day» in the «Due date» menu of a task (PLNRAPP-137, PLNRAPP-864): due today / tomorrow; no «remove from
// the day» — a task leaves the day only by a due date change (another date or «Clear» of the menu)
const props = defineProps<{ taskId: string }>();
const emit = defineEmits<{ done: [] }>();
const { t } = useI18n();
const task = useQuery(() => db.table<Row<'tasks'>>('tasks').get(props.taskId));
const to = (date: string) => {
  emit('done');
  void planFor(props.taskId, date);
};
</script>

<template>
  <div v-if="task" class="flex flex-col border-b border-border pb-2" data-testid="day-options">
    <Button
      v-if="task.dueDate !== localToday()"
      size="sm"
      variant="ghost"
      class="justify-start"
      data-testid="day-options-today"
      @click="to(localToday())"
      ><Sun :size="14" aria-hidden="true" />{{ t('myDay.today') }}</Button
    >
    <Button
      v-if="task.dueDate !== localToday(1)"
      size="sm"
      variant="ghost"
      class="justify-start"
      data-testid="day-options-tomorrow"
      @click="to(localToday(1))"
      ><CalendarClock :size="14" aria-hidden="true" />{{ t('myDay.toTomorrow') }}</Button
    >
  </div>
</template>
