<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AssigneePicker,
  DueDatePicker,
  PriorityPicker,
  PriorityIcon,
  LabelPicker,
  StatusPicker,
  setAssignees,
  setLabels,
  updateTask,
  type TaskView,
} from '../../tasks';
import type { Row as DbRow } from '@planar/shared';
import { AvatarStack, Badge } from '../../ui';
import { GripVertical } from 'lucide-vue-next';
import { BlockedIcon } from '../../links';
import type { TaskField } from '../options';
import { localToday } from '../filter';
import { formatDue } from './due';

const props = defineProps<{
  task: TaskView;
  spaceId: string;
  index: number;
  selected: boolean;
  focused: boolean;
  editing: boolean;
  fields: TaskField[];
  blocked: boolean;
  members: DbRow<'users'>[];
  labels: DbRow<'labels'>[];
  /** уровень вложенности подзадачи (0 — верхний) */
  depth?: number;
  /** родитель не показан над строкой (другая группа, подзадачи скрыты) — подпись в строке */
  parentTitle?: string;
  /** ручка перетаскивания (сортировка «Вручную») */
  draggable?: boolean;
}>();
const emit = defineEmits<{
  click: [e: MouseEvent];
  drag: [e: PointerEvent];
  toggle: [];
  edit: [];
  done: [];
}>();
const { t, locale } = useI18n();
// пикеры справа видны только при наведении/фокусе — до этого не монтируем (переключение проекта)
const hot = ref(false);
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

const labelsSet = computed(() =>
  props.task.labelIds.flatMap((id) => props.labels.find((l) => l.id === id) ?? []),
);
const people = computed(() =>
  props.task.assigneeIds.map((id) => ({
    name: props.members.find((u) => u.id === id)?.name ?? '?',
  })),
);
// просрочен (раньше локального сегодня) — danger, сегодня и завтра — warning
const dueTone = computed(() => {
  const d = props.task.dueDate;
  if (!d) return '';
  const today = localToday();
  const next = new Date();
  next.setDate(next.getDate() + 1);
  const tomorrow = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  return d < today ? 'text-danger' : d <= tomorrow ? 'text-warning' : 'text-fg-muted';
});

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
      'group relative flex h-full items-center gap-2 border-b border-border px-3 text-sm',
      selected ? 'bg-accent-subtle' : 'hover:bg-bg-subtle',
      focused ? 'ring-2 ring-inset ring-focus' : '',
    ]"
    @click="emit('click', $event)"
    @pointerenter="hot = true"
    @focusin="hot = true"
  >
    <div
      v-if="draggable"
      class="-ml-2 flex w-4 shrink-0 cursor-grab items-center justify-center text-fg-subtle opacity-0 group-hover:opacity-100 touch-none"
      data-testid="row-grip"
      :aria-label="t('list.drag')"
      @pointerdown.stop.prevent="emit('drag', $event)"
      @click.stop
    >
      <GripVertical :size="14" />
    </div>
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
    <span v-if="depth" class="shrink-0" :style="{ width: `${depth * 20}px` }" aria-hidden="true" />
    <div role="gridcell" class="w-16 shrink-0 truncate font-mono text-xs text-fg-muted">
      {{ task.key }}
    </div>
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
      <span v-else class="flex items-center gap-1">
        <BlockedIcon v-if="blocked" />
        <span
          v-if="parentTitle"
          class="max-w-48 shrink-0 truncate text-xs text-fg-subtle"
          data-testid="row-parent"
          >{{ parentTitle }} ›</span
        >
        <span class="truncate">{{ task.title }}</span>
      </span>
    </div>
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <!-- пустая ячейка занимает колонку: метки, срок и аватары не прыгают от строки к строке -->
      <div
        v-if="fields.includes('labels')"
        role="gridcell"
        class="hidden w-32 items-center gap-2 overflow-hidden md:flex"
      >
        <Badge v-for="l in labelsSet" :key="l.id" dot :color="l.color ?? undefined">{{
          l.name
        }}</Badge>
      </div>
      <div v-if="fields.includes('priority')" role="gridcell" class="flex w-4 justify-center">
        <PriorityIcon v-if="task.priority" :priority="task.priority" />
      </div>
      <div
        v-if="fields.includes('dueDate')"
        role="gridcell"
        :class="['hidden w-14 text-xs md:block', dueTone]"
      >
        {{ task.dueDate ? formatDue(task.dueDate, locale) : '' }}
      </div>
      <div v-if="fields.includes('assignee')" role="gridcell" class="flex w-12 justify-end">
        <AvatarStack :people="people" size="xs" />
      </div>
    </div>
    <div
      class="pointer-events-none absolute inset-y-0 right-2 flex items-center bg-inherit opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
      @click.stop
    >
      <div v-if="fields.includes('labels')" role="gridcell">
        <LabelPicker
          v-if="hot || focused"
          compact
          :space-id="spaceId"
          :model-value="task.labelIds"
          @update:model-value="setLabels(task.id, $event)"
        />
      </div>
      <div v-if="fields.includes('priority')" role="gridcell">
        <PriorityPicker
          v-if="hot || focused"
          compact
          :model-value="task.priority"
          @update:model-value="updateTask(task.id, { priority: $event })"
        />
      </div>
      <div v-if="fields.includes('assignee')" role="gridcell">
        <AssigneePicker
          v-if="hot || focused"
          compact
          :space-id="spaceId"
          :model-value="task.assigneeIds"
          @update:model-value="setAssignees(task.id, $event)"
        />
      </div>
      <div v-if="fields.includes('dueDate')" role="gridcell">
        <DueDatePicker
          v-if="hot || focused"
          compact
          :model-value="task.dueDate"
          @update:model-value="updateTask(task.id, { dueDate: $event })"
        />
      </div>
    </div>
  </div>
</template>
