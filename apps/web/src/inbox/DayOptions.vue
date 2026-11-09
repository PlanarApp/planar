<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarClock, Sun, X } from 'lucide-vue-next';
import { Button } from '../ui';
import { useAuth } from '../auth/useAuth';
import { localToday } from '../views/filter';
import { planFor, planOf, unplan, useMyDay } from './myDay';

// «My day» in the «Due date» menu of a task (PLNRAPP-137): plan for today / tomorrow or remove from the plan
const props = defineProps<{ taskId: string }>();
const emit = defineEmits<{ done: [] }>();
const { t } = useI18n();
const day = useMyDay(() => useAuth().user.value?.id);
const plan = computed(() => planOf(day.value, props.taskId));
const to = (date: string) => {
  emit('done');
  if (day.value) void planFor(props.taskId, date, day.value);
};
const remove = () => {
  emit('done');
  if (plan.value) void unplan(plan.value.id);
};
</script>

<template>
  <div v-if="day" class="flex flex-col border-b border-border pb-2" data-testid="day-options">
    <Button
      v-if="plan?.date !== localToday()"
      size="sm"
      variant="ghost"
      class="justify-start"
      data-testid="day-options-today"
      @click="to(localToday())"
      ><Sun :size="14" aria-hidden="true" />{{ t('myDay.add') }}</Button
    >
    <Button
      v-if="plan?.date !== localToday(1)"
      size="sm"
      variant="ghost"
      class="justify-start"
      data-testid="day-options-tomorrow"
      @click="to(localToday(1))"
      ><CalendarClock :size="14" aria-hidden="true" />{{ t('myDay.toTomorrow') }}</Button
    >
    <Button
      v-if="plan"
      size="sm"
      variant="ghost"
      class="justify-start"
      data-testid="day-options-remove"
      @click="remove"
      ><X :size="14" aria-hidden="true" />{{ t('myDay.remove') }}</Button
    >
  </div>
</template>
