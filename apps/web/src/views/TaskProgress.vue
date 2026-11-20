<script setup lang="ts">
import type { AssignedComments } from '@planar/shared';
import { ListChecks, ListTree, MessageSquare } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useTaskProgress, type Ratio } from './progress';

// PLNRAPP-333: progress of the subtasks and the checklist on a list row / board card — «closed/total»,
// all closed — in green; nothing when the task has neither.
// PLNRAPP-577: next to the subtasks — assigned comments «resolved/total» (icon as the «Comments for me» tab
// of My work); none — hidden; an open one assigned to me — accent; the click does nothing
const props = defineProps<{ taskId: string; comments?: AssignedComments }>();
const { t } = useI18n();
const progress = useTaskProgress(props.taskId);
const chip = (r: Ratio) => [
  'inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs',
  r.done === r.total ? 'text-success' : 'text-fg-muted',
];
const commentsChip = (c: AssignedComments) =>
  c.assignedToMe
    ? 'inline-flex shrink-0 items-center gap-0.5 rounded border border-accent bg-accent-subtle px-1 text-xs text-accent'
    : chip({ done: c.resolved, total: c.total });
</script>

<template>
  <span
    v-if="progress?.subtasks.total"
    :class="chip(progress.subtasks)"
    :title="t('task.subtasks')"
    data-testid="row-children"
    ><ListTree :size="12" />{{ progress.subtasks.done }}/{{ progress.subtasks.total }}</span
  >
  <span
    v-if="comments?.total"
    :class="commentsChip(comments)"
    :title="t('task.assignedComments')"
    :data-mine="comments.assignedToMe || undefined"
    data-testid="row-comments"
    @click.stop
    ><MessageSquare :size="12" />{{ comments.resolved }}/{{ comments.total }}</span
  >
  <span
    v-if="progress?.checklist.total"
    :class="chip(progress.checklist)"
    :title="t('task.checklist')"
    data-testid="row-checklist"
    ><ListChecks :size="12" />{{ progress.checklist.done }}/{{ progress.checklist.total }}</span
  >
</template>
