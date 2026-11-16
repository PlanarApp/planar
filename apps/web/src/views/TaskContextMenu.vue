<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CheckSquare, Square } from 'lucide-vue-next';
import Menu, { type MenuItem } from '../ui/Menu.vue';
import { useTaskMenu } from '../tasks/taskMenu';
import type { TaskView } from '../tasks';
import { useSelection } from './selection';

// one menu per view (not per row — rows are virtualized, and a reka menu is expensive to mount)
const props = defineProps<{
  spaceId: string;
  tasks: readonly TaskView[] | undefined;
  /** «Выбрать» item (PLNRAPP-291): turns the selection mode on with this task — Board and List */
  selectable?: boolean;
}>();
const { t } = useI18n();
const sel = useSelection();
const menuFor = useTaskMenu(() => props.spaceId);
const task = ref<TaskView>();
const selectItem = (x: TaskView): MenuItem[] => {
  const on = sel.selected.value.has(x.id);
  return [
    {
      id: 'select',
      label: t(on ? 'taskMenu.unselect' : 'taskMenu.select'),
      icon: on ? Square : CheckSquare,
      onSelect: () => sel.toggle(x.id),
    },
    { separator: true },
  ];
};
const items = computed(() =>
  task.value ? [...(props.selectable ? selectItem(task.value) : []), ...menuFor(task.value)] : [],
);

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
