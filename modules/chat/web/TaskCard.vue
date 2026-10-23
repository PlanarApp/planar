<script setup lang="ts">
import { computed } from 'vue';
import { openTask, useStatuses, useTask } from '@planar/web/modules';

const props = defineProps<{ taskKey: string }>();
const task = useTask(() => props.taskKey);
const statuses = useStatuses(() => task.value?.spaceId ?? '');
const status = computed(() => statuses.value?.find((s) => s.id === task.value?.statusId)?.name);
</script>

<template>
  <button
    v-if="task"
    type="button"
    data-testid="chat-task-card"
    class="mt-1 flex max-w-sm items-center gap-2 rounded-md border border-border px-2 py-1 text-left text-sm hover:bg-bg-muted"
    @click="openTask(taskKey)"
  >
    <span class="font-medium text-fg-muted">{{ taskKey }}</span>
    <span class="truncate">{{ task.title }}</span>
    <span v-if="status" class="shrink-0 text-xs text-fg-subtle">{{ status }}</span>
  </button>
</template>
