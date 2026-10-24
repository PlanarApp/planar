<script setup lang="ts">
import { computed } from 'vue';
import { Button, openTask, useStatuses, useTask } from '@planar/web/modules';

const props = defineProps<{ taskKey: string }>();
const task = useTask(() => props.taskKey);
const statuses = useStatuses(() => task.value?.spaceId ?? '');
const status = computed(() => statuses.value?.find((s) => s.id === task.value?.statusId)?.name);
</script>

<template>
  <Button
    v-if="task"
    size="sm"
    data-testid="chat-task-card"
    class="mt-1 max-w-sm justify-start"
    @click="openTask(taskKey)"
  >
    <span class="font-medium text-fg-muted">{{ taskKey }}</span>
    <span class="truncate">{{ task.title }}</span>
    <span v-if="status" class="shrink-0 text-xs text-fg-subtle">{{ status }}</span>
  </Button>
</template>
