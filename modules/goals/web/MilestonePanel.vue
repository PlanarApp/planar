<script setup lang="ts">
import { computed } from 'vue';
import { Select, db, useQuery } from '@planar/web/modules';
import type { Row } from '@planar/shared';
import type { Milestone, MilestoneTask } from '../shared/index.js';
import { hasTables, newId, run, text } from './data';

const props = defineProps<{ taskId: string }>();
const tx = computed(text);
const data = useQuery(async () => {
  const t = await db.table<Row<'tasks'>>('tasks').get(props.taskId);
  if (!t || !hasTables()) return null;
  const [ms, link] = await Promise.all([
    db.table<Milestone>('goalsMilestones').where('projectId').equals(t.projectId).toArray(),
    db.table<MilestoneTask>('goalsMilestoneTasks').where('taskId').equals(props.taskId).first(),
  ]);
  return { ms: ms.sort((a, b) => (a.date < b.date ? -1 : 1)), current: link?.milestoneId };
});
// Reka Select does not accept an empty value
const NONE = '__none';
const choices = computed(() => [
  { value: NONE, label: tx.value.noMilestone },
  ...(data.value?.ms ?? []).map((m) => ({ value: m.id, label: `${m.name} · ${m.date}` })),
]);
const change = (v: string | null) =>
  run('goals.milestone.setTask', {
    id: newId(),
    taskId: props.taskId,
    milestoneId: v && v !== NONE ? v : null,
  });
</script>

<template>
  <div class="flex items-center gap-2 p-2 text-sm" data-testid="milestone-panel">
    {{ tx.milestone }}
    <Select
      :model-value="data?.current ?? NONE"
      :label="tx.milestone"
      :options="choices"
      @update:model-value="change"
    />
  </div>
</template>
