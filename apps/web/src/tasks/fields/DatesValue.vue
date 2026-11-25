<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { dateTone, formatDue } from '../../views/list/due';

// a task's start and due date, each in its own color (past / today / future); only a start — «from 12 Nov»
defineProps<{ start: string | null; due: string | null }>();
const { t, locale } = useI18n();
</script>

<template>
  <span v-if="start || due" class="truncate" data-testid="task-dates-value">
    <span v-if="start" :class="dateTone(start)">{{
      due ? formatDue(start, locale) : t('task.fromDate', { date: formatDue(start, locale) })
    }}</span>
    <span v-if="start && due" class="text-fg-muted"> – </span>
    <span v-if="due" :class="dateTone(due)">{{ formatDue(due, locale) }}</span>
  </span>
</template>
