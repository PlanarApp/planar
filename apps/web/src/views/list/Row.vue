<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AssigneePicker,
  DueDatePicker,
  PriorityPicker,
  LabelPicker,
  StatusPicker,
  setAssignees,
  setLabels,
  updateTask,
  type TaskView,
} from '../../tasks';
import type { TaskField } from '../options';

const props = defineProps<{
  task: TaskView;
  spaceId: string;
  index: number;
  selected: boolean;
  focused: boolean;
  editing: boolean;
  fields: TaskField[];
}>();
const emit = defineEmits<{
  click: [e: MouseEvent];
  toggle: [];
  edit: [];
  done: [];
}>();
const { t } = useI18n();
const input = ref<HTMLInputElement>();
const draft = ref('');
let live = false; // blur после Enter/Esc не сохраняет повторно

watch(
  () => props.editing,
  async (e) => {
    live = e;
    if (!e) return;
    draft.value = props.task.title;
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
  { immediate: true },
);

function save() {
  if (!live) return;
  live = false;
  const title = draft.value.trim();
  emit('done'); // сначала выходим из режима правки: blur при размонтировании не сохранит повторно
  if (title && title !== props.task.title) void updateTask(props.task.id, { title });
}
</script>

<template>
  <div
    role="row"
    :aria-rowindex="index"
    :aria-selected="selected"
    :data-task="task.key"
    :class="[
      'group flex h-full items-center gap-2 border-b border-border px-3 text-sm',
      selected ? 'bg-accent-subtle' : 'hover:bg-bg-subtle',
      focused ? 'ring-2 ring-inset ring-focus' : '',
    ]"
    @click="emit('click', $event)"
  >
    <div role="gridcell" class="w-5 shrink-0" @click.stop>
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="t('list.select')"
        :class="[
          'size-4 focus-visible:opacity-100 group-hover:opacity-100',
          selected ? 'opacity-100' : 'opacity-0',
        ]"
        @change="(emit('toggle'), emit('done'))"
      />
    </div>
    <div role="gridcell" class="w-16 shrink-0 truncate text-xs text-fg-subtle">{{ task.key }}</div>
    <div v-if="fields.includes('status')" role="gridcell" class="shrink-0" @click.stop>
      <StatusPicker
        compact
        :space-id="spaceId"
        :model-value="task.statusId"
        @update:model-value="updateTask(task.id, { statusId: $event })"
      />
    </div>
    <div role="gridcell" class="min-w-0 flex-1" @dblclick.stop="emit('edit')">
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        :aria-label="t('list.editTitle')"
        class="h-7 w-full rounded-md border border-border-strong bg-bg px-2 text-sm outline-none focus-visible:ring-2 ring-focus"
        @click.stop
        @keydown.enter.prevent="save"
        @keydown.esc.stop.prevent="((live = false), emit('done'))"
        @blur="save"
      />
      <span v-else class="block truncate">{{ task.title }}</span>
    </div>
    <div v-if="fields.includes('labels')" role="gridcell" class="shrink-0" @click.stop>
      <LabelPicker
        compact
        :space-id="spaceId"
        :model-value="task.labelIds"
        @update:model-value="setLabels(task.id, $event)"
      />
    </div>
    <div v-if="fields.includes('priority')" role="gridcell" class="shrink-0" @click.stop>
      <PriorityPicker
        compact
        :model-value="task.priority"
        @update:model-value="updateTask(task.id, { priority: $event })"
      />
    </div>
    <div v-if="fields.includes('assignee')" role="gridcell" class="shrink-0" @click.stop>
      <AssigneePicker
        compact
        :space-id="spaceId"
        :model-value="task.assigneeIds"
        @update:model-value="setAssignees(task.id, $event)"
      />
    </div>
    <div
      v-if="fields.includes('dueDate')"
      role="gridcell"
      class="hidden shrink-0 md:block"
      @click.stop
    >
      <DueDatePicker
        compact
        :model-value="task.dueDate"
        @update:model-value="updateTask(task.id, { dueDate: $event })"
      />
    </div>
  </div>
</template>
