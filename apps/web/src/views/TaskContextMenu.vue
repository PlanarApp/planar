<script setup lang="ts">
import { computed, ref } from 'vue';
import Menu from '../ui/Menu.vue';
import { useTaskMenu } from '../tasks/taskMenu';
import type { TaskView } from '../tasks';

// одно меню на вид (не на строку — строки виртуализированы, а меню reka дорого монтировать)
const props = defineProps<{ spaceId: string; tasks: readonly TaskView[] | undefined }>();
const menuFor = useTaskMenu(() => props.spaceId);
const task = ref<TaskView>();
const items = computed(() => (task.value ? menuFor(task.value) : []));

// capture на обёртке раньше триггера: вне задачи — обычное меню браузера
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
