<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CheckSquare, Square } from 'lucide-vue-next';
import Menu, { type MenuItem } from '../ui/Menu.vue';
import { useTaskMenu, type TaskMenuField } from '../tasks/taskMenu';
import {
  AssigneePicker,
  PriorityPicker,
  setAssignees,
  StatusPicker,
  TaskDatesPicker,
  updateTask,
  type TaskView,
} from '../tasks';
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
const task = ref<TaskView>();
// the value fields of the menu open their picker at the point of the right-click (an invisible trigger there);
// data-inline-edit: the closing menu gives the focus to it, not back to the row (that would close the picker)
const at = { x: 0, y: 0 };
const field = ref<{ name: TaskMenuField; task: TaskView; x: number; y: number } | null>(null);
const fieldOpen = ref(false);
const menuFor = useTaskMenu(
  () => props.spaceId,
  (name, x) => {
    field.value = { name, task: x, ...at };
    // after the menu has closed and given the focus back
    requestAnimationFrame(() => (fieldOpen.value = true));
  },
);
watch(fieldOpen, (o) => o || (field.value = null));
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
  at.x = e.clientX;
  at.y = e.clientY;
  const key = (e.target as Element).closest<HTMLElement>('[data-task]')?.dataset.task;
  task.value = key ? props.tasks?.find((x) => x.key === key) : undefined;
  if (!task.value) e.stopPropagation();
}
</script>

<template>
  <div class="contents" @contextmenu.capture="pick">
    <Menu context :items="items"><slot /></Menu>
  </div>
  <div
    v-if="field"
    class="pointer-events-none fixed size-0 opacity-0"
    :style="{ left: `${field.x}px`, top: `${field.y}px` }"
    tabindex="-1"
    data-inline-edit
    data-testid="menu-field"
  >
    <StatusPicker
      v-if="field.name === 'status'"
      v-model:open="fieldOpen"
      compact
      :space-id="field.task.spaceId"
      :project-id="field.task.projectId"
      :model-value="field.task.statusId"
      @update:model-value="updateTask(field.task.id, { statusId: $event })"
    />
    <PriorityPicker
      v-else-if="field.name === 'priority'"
      v-model:open="fieldOpen"
      compact
      :model-value="field.task.priority"
      @update:model-value="updateTask(field.task.id, { priority: $event })"
    />
    <AssigneePicker
      v-else-if="field.name === 'assignee'"
      v-model:open="fieldOpen"
      compact
      :space-id="field.task.spaceId"
      :model-value="field.task.assigneeIds"
      @update:model-value="setAssignees(field.task.id, $event)"
    />
    <TaskDatesPicker
      v-else
      v-model:open="fieldOpen"
      :task-id="field.task.id"
      :start="field.task.startDate"
      :due="field.task.dueDate"
      :start-time="field.task.startTime"
      :due-time="field.task.dueTime"
      @update:start="(v: string | null) => updateTask(field!.task.id, { startDate: v })"
      @update:due="(v: string | null) => updateTask(field!.task.id, { dueDate: v })"
      @update:start-time="(v: string | null) => updateTask(field!.task.id, { startTime: v })"
      @update:due-time="(v: string | null) => updateTask(field!.task.id, { dueTime: v })"
    />
  </div>
</template>
