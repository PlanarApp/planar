<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { dateTone, formatDue } from '../../views/list/due';

// a task's start and due date, each in its own color (past / today / future); only a start — «from 12 Nov»
defineProps<{
  start: string | null;
  due: string | null;
  startTime?: string | null;
  dueTime?: string | null;
}>();
const { t, locale } = useI18n();
// «12 Nov 14:30» — the time is optional
const at = (d: string, tm?: string | null) =>
  tm ? `${formatDue(d, locale.value)} ${tm}` : formatDue(d, locale.value);
</script>

<template>
  <span v-if="start || due" class="truncate" data-testid="task-dates-value">
    <span v-if="start" :class="dateTone(start)">{{
      due ? at(start, startTime) : t('task.fromDate', { date: at(start, startTime) })
    }}</span>
    <span v-if="start && due" class="text-fg-muted"> – </span>
    <span v-if="due" :class="dateTone(due)">{{ at(due, dueTime) }}</span>
  </span>
</template>
