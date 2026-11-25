<script setup lang="ts">
import { useSubtasks } from '../../task/queries';
import { StatusPicker, updateTask } from '../../tasks';
import { openTask } from '../open';

// the subtasks of a Board card, opened by its subtasks chip: the status (changeable) and the name (opens it)
const props = defineProps<{ taskId: string; spaceId: string }>();
const subtasks = useSubtasks(props.taskId);
</script>

<template>
  <ul
    class="-mx-1.5 flex flex-col border-t border-border pt-1"
    data-no-drag
    data-testid="card-subtasks"
  >
    <li
      v-for="x in subtasks ?? []"
      :key="x.id"
      class="flex min-w-0 items-center gap-0.5"
      @click.stop
    >
      <StatusPicker
        compact
        :space-id="spaceId"
        :project-id="x.projectId"
        :model-value="x.statusId"
        @update:model-value="updateTask(x.id, { statusId: $event })"
      />
      <button
        type="button"
        class="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-fg outline-none hover:underline focus-visible:ring-2 ring-focus"
        :title="`${x.key} ${x.title}`"
        :data-task="x.key"
        @click="openTask(x.key)"
      >
        {{ x.title }}
      </button>
    </li>
  </ul>
</template>
