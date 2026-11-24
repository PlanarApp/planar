<script setup lang="ts">
import { assignedCommentsOf, type AssignedComments } from '@planar/shared';
import { computed } from 'vue';
import { ListChecks, ListTree, MessageSquare } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useAuth } from '../auth/useAuth';
import { useTaskProgress, type Ratio } from './progress';

// PLNRAPP-333: progress of the subtasks and the checklist on a list row / board card — «closed/total»,
// all closed — in green (the subtasks — a highlighted chip); nothing when the task has neither.
// PLNRAPP-577: next to the subtasks — assigned comments, the number of open ones (icon as the «Comments for me»
// tab of My work); none open — hidden; an open one assigned to me — in orange, without the border (PLNRAPP-819,
// as the green chip of closed subtasks); the click does nothing.
// «Mine» is counted here from the tasks row counters and the signed-in user (reactively): the cached project
// projection may be built before /api/auth/me answers, and then the accent would be missing until the task changes.
const props = defineProps<{
  taskId: string;
  comments?: Parameters<typeof assignedCommentsOf>[0];
}>();
const auth = useAuth();
const assigned = computed(
  () => props.comments && assignedCommentsOf(props.comments, auth.user.value?.id),
);
const { t } = useI18n();
const progress = useTaskProgress(props.taskId);
const chip = (r: Ratio) => [
  'inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs',
  r.done === r.total ? 'text-success' : 'text-fg-muted',
];
const subtasksChip = (r: Ratio) =>
  r.done === r.total
    ? 'inline-flex shrink-0 items-center gap-0.5 rounded border border-success bg-success/10 px-1 text-xs text-success'
    : chip(r);
const commentsChip = (c: AssignedComments) =>
  c.assignedToMe
    ? 'inline-flex shrink-0 items-center gap-0.5 rounded border border-transparent bg-warning/10 px-1 text-xs text-warning'
    : chip({ done: 0, total: 1 });
</script>

<template>
  <span
    v-if="progress?.subtasks.total"
    :class="subtasksChip(progress.subtasks)"
    :title="t('task.subtasks')"
    data-testid="row-children"
    ><ListTree :size="12" />{{ progress.subtasks.done }}/{{ progress.subtasks.total }}</span
  >
  <span
    v-if="assigned && assigned.total > assigned.resolved"
    :class="commentsChip(assigned)"
    :title="t('task.assignedComments')"
    :data-mine="assigned.assignedToMe || undefined"
    data-testid="row-comments"
    @click.stop
    ><MessageSquare :size="12" />{{ assigned.total - assigned.resolved }}</span
  >
  <span
    v-if="progress?.checklist.total"
    :class="chip(progress.checklist)"
    :title="t('task.checklist')"
    data-testid="row-checklist"
    ><ListChecks :size="12" />{{ progress.checklist.done }}/{{ progress.checklist.total }}</span
  >
</template>
