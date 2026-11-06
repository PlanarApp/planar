<script setup lang="ts">
import { CalendarDays, Flag, Tag, UserRound } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { Row as DbRow } from '@planar/shared';
import { AvatarStack, Badge } from '../../ui';
import { PriorityIcon } from '../../tasks';
import type { ListColumn } from './columns';
import { formatDue } from './due';

// List cell value — the same at rest and inside the picker button (nothing changes on hover)
defineProps<{
  col: ListColumn;
  people: { name: string }[];
  dueDate: string | null;
  dueTone: string;
  priority: number;
  labels: DbRow<'labels'>[];
  /** the task's project name (the "Project" field) */
  project?: string;
}>();
const { t, locale } = useI18n();
const empty = 'text-fg-subtle opacity-50';
</script>

<template>
  <span v-if="col === 'project'" class="truncate text-sm text-fg-muted" :title="project">{{
    project
  }}</span>
  <template v-else-if="col === 'assignee'">
    <!-- только аватары (имена — в подсказке) -->
    <AvatarStack v-if="people.length" :people="people" />
    <UserRound v-else :size="16" :class="empty" :aria-label="t('tasks.noAssignee')" />
  </template>
  <template v-else-if="col === 'dueDate'">
    <span v-if="dueDate" :class="['text-sm', dueTone]">{{ formatDue(dueDate, locale) }}</span>
    <CalendarDays v-else :size="16" :class="empty" aria-hidden="true" />
  </template>
  <template v-else-if="col === 'priority'">
    <span v-if="priority" class="flex items-center gap-1.5 text-sm">
      <PriorityIcon :priority="priority" />{{ t(`tasks.priority.${priority}`) }}
    </span>
    <Flag v-else :size="16" :class="empty" aria-hidden="true" />
  </template>
  <template v-else>
    <span v-if="labels.length" class="flex gap-1 overflow-hidden">
      <Badge v-for="l in labels" :key="l.id" dot :color="l.color ?? undefined">{{ l.name }}</Badge>
    </span>
    <Tag v-else :size="16" :class="empty" aria-hidden="true" />
  </template>
</template>
