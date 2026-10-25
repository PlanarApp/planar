<script setup lang="ts">
import { CalendarDays, Flag, Tag } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { Row as DbRow } from '@planar/shared';
import { AvatarStack, Badge } from '../../ui';
import { PriorityIcon } from '../../tasks';
import type { ListColumn } from './columns';
import { formatDue } from './due';

// значение ячейки Списка — одно и то же в покое и внутри кнопки пикера (при наведении ничего не меняется)
defineProps<{
  col: ListColumn;
  people: { name: string }[];
  dueDate: string | null;
  dueTone: string;
  priority: number;
  labels: DbRow<'labels'>[];
}>();
const { t, locale } = useI18n();
const empty = 'text-fg-subtle opacity-50';
</script>

<template>
  <template v-if="col === 'assignee'">
    <!-- как в селекторе: аватар и имя; несколько — первое имя и «+N» -->
    <span
      v-if="people.length"
      class="flex min-w-0 items-center gap-1.5 text-sm"
      :title="people.map((p) => p.name).join(', ')"
    >
      <AvatarStack :people="people.slice(0, 1)" size="xs" />
      <span class="truncate">{{ people[0]!.name }}</span>
      <span v-if="people.length > 1" class="shrink-0 text-fg-muted">+{{ people.length - 1 }}</span>
    </span>
    <span v-else class="truncate text-sm text-fg-subtle">{{ t('tasks.noAssignee') }}</span>
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
