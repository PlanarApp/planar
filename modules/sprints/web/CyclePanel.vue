<script setup lang="ts">
import { computed } from 'vue';
import { Select, db, useQuery } from '@planar/web/modules';
import type { Row } from '@planar/shared';
import type { Cycle } from '../shared/index.js';
import { hasTables, run, text } from './data';

const props = defineProps<{ taskId: string }>();
const tx = computed(text);
const task = useQuery(() => db.table<Row<'tasks'>>('tasks').get(props.taskId));
const cycles = useQuery(async () => {
  const t = await db.table<Row<'tasks'>>('tasks').get(props.taskId);
  if (!t || !hasTables()) return [];
  const all = await db
    .table<Cycle>('sprintsCycles')
    .where('projectId')
    .equals(t.projectId)
    .toArray();
  return all.sort((a, b) => a.number - b.number);
});
// closed cycles are shown only if the task is still in it
const options = computed(() =>
  (cycles.value ?? []).filter((c) => !c.closedAt || c.id === task.value?.cycleId),
);
const label = (c: Cycle) => `${tx.value.cycle} ${c.number}${c.name ? ` · ${c.name}` : ''}`;
// Reka Select does not accept an empty value
const NONE = '__none';
const choices = computed(() => [
  { value: NONE, label: tx.value.noCycle },
  ...options.value.map((c) => ({ value: c.id, label: label(c) })),
]);
const change = (v: string | null) =>
  run('sprints.setTask', { taskId: props.taskId, cycleId: v && v !== NONE ? v : null });
</script>

<template>
  <div class="flex items-center gap-2 p-2 text-sm" data-testid="cycle-panel">
    {{ tx.cycle }}
    <div data-role="cycle">
      <Select
        :model-value="task?.cycleId ?? NONE"
        :label="tx.cycle"
        :options="choices"
        @update:model-value="change"
      />
    </div>
  </div>
</template>
