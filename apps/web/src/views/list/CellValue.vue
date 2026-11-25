<script setup lang="ts">
import { CalendarDays, Flag, Tag, UserRound } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { Row as DbRow } from '@planar/shared';
import { AvatarStack } from '../../ui';
import { PriorityIcon } from '../../tasks';
import type { ListColumn } from './columns';
import DatesValue from '../../tasks/fields/DatesValue.vue';
import LabelsValue from '../../tasks/fields/LabelsValue.vue';

// List cell value — the same at rest and inside the picker button (nothing changes on hover)
defineProps<{
  col: ListColumn;
  people: { name: string }[];
  startDate: string | null;
  dueDate: string | null;
  priority: number;
  labels: DbRow<'labels'>[];
  /** the task's project name (the "Project" field) */
  project?: string;
  /** label names next to the tag icons (the "Show label names" option) */
  labelNames?: boolean;
}>();
const { t } = useI18n();
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
    <DatesValue v-if="startDate || dueDate" class="text-sm" :start="startDate" :due="dueDate" />
    <CalendarDays v-else :size="16" :class="empty" aria-hidden="true" />
  </template>
  <template v-else-if="col === 'priority'">
    <span v-if="priority" class="flex items-center gap-1.5 text-sm">
      <PriorityIcon :priority="priority" />{{ t(`tasks.priority.${priority}`) }}
    </span>
    <Flag v-else :size="16" :class="empty" aria-hidden="true" />
  </template>
  <template v-else>
    <LabelsValue v-if="labels.length" :labels="labels" :names="labelNames" />
    <Tag v-else :size="16" :class="empty" aria-hidden="true" />
  </template>
</template>
