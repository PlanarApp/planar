<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { activityOf, useProjectActivity } from '../../modules/activity';

// PLNRAPP-401: the AI columns of a list row (status, cost, time of the runs) —
// from the project's shared activity source
const props = defineProps<{
  task: { id: string; key: string; projectId: string };
  col: 'ai' | 'aiCost' | 'aiTime';
}>();
const { t } = useI18n();
const all = useProjectActivity(() => props.task.projectId);
const work = computed(() => activityOf(all.value, props.task.id));
const text = computed(() => {
  const w = work.value;
  if (!w) return '';
  if (props.col === 'ai') return t(`tasks.aiState.${w.state}`);
  const u = w.usage;
  if (!u?.runs) return '';
  if (props.col === 'aiCost') return u.cost == null ? '' : `$${u.cost.toFixed(2)}`;
  return u.seconds < 60
    ? `${Math.round(u.seconds)} ${t('tasks.aiSec')}`
    : `${Math.round(u.seconds / 60)} ${t('tasks.aiMin')}`;
});
</script>

<template>
  <span class="truncate text-sm text-fg-muted" :data-testid="`cell-${col}`">{{ text || '—' }}</span>
</template>
