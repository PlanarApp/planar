<script setup lang="ts">
import { computed } from 'vue';
import { activityOf, useProjectActivity } from '../modules/activity';
import AiStatusIcon from '../task/AiStatusIcon.vue';

// PLNRAPP-322/323: the AI status of a task in a list row and on a board card — from the project's shared source;
// the link opens the task on the module's panel with the runs
const props = defineProps<{ task: { id: string; key: string; projectId: string } }>();
const all = useProjectActivity(() => props.task.projectId);
const work = computed(() => activityOf(all.value, props.task.id));
const runUrl = computed(() => {
  const w = work.value;
  const q = w?.panel ? `?panel=${encodeURIComponent(`${w.moduleId}:${w.panel}`)}` : '';
  return `/t/${encodeURIComponent(props.task.key)}${q}`;
});
</script>

<template>
  <AiStatusIcon
    v-if="work && (work.state === 'running' || work.state === 'failed')"
    :status="work.state"
    :run-url="runUrl"
    :started-at="work.startedAt"
    :finished-at="work.finishedAt"
    :error-message="work.error"
  />
</template>
