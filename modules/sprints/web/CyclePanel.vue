<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '../../../apps/web/src/sync';
import { db } from '../../../apps/web/src/sync';
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
// закрытые цикл показываем только если задача в нём осталась
const options = computed(() =>
  (cycles.value ?? []).filter((c) => !c.closedAt || c.id === task.value?.cycleId),
);
const label = (c: Cycle) => `${tx.value.cycle} ${c.number}${c.name ? ` · ${c.name}` : ''}`;
const change = (e: Event) =>
  run('sprints.setTask', {
    taskId: props.taskId,
    cycleId: (e.target as HTMLSelectElement).value || null,
  });
</script>

<template>
  <label class="flex items-center gap-2 p-2 text-sm" data-testid="cycle-panel">
    {{ tx.cycle }}
    <select
      class="h-11 rounded-md border border-border-strong bg-bg px-2 text-base text-fg md:h-8"
      :value="task?.cycleId ?? ''"
      data-role="cycle"
      @change="change"
    >
      <option value="">{{ tx.noCycle }}</option>
      <option v-for="c in options" :key="c.id" :value="c.id">{{ label(c) }}</option>
    </select>
  </label>
</template>
