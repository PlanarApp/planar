<script setup lang="ts">
import { computed, ref } from 'vue';
import Menu from '../ui/Menu.vue';
import { useTaskMenu } from '../tasks/taskMenu';
import type { TaskView } from '../tasks';

// one menu per view (not per row — rows are virtualized, and a reka menu is expensive to mount)
const props = defineProps<{ spaceId: string; tasks: readonly TaskView[] | undefined }>();
const menuFor = useTaskMenu(() => props.spaceId);
const task = ref<TaskView>();
const items = computed(() => (task.value ? menuFor(task.value) : []));

// capture on the wrapper runs before the trigger: outside a task — the browser's normal menu
function pick(e: MouseEvent) {
  const key = (e.target as Element).closest<HTMLElement>('[data-task]')?.dataset.task;
  task.value = key ? props.tasks?.find((x) => x.key === key) : undefined;
  if (!task.value) e.stopPropagation();
}
</script>

<template>
  <div class="contents" @contextmenu.capture="pick">
    <Menu context :items="items"><slot /></Menu>
  </div>
</template>
