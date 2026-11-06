<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
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
import type { Row as DbRow } from '@planar/shared';
import { ChevronDown, ChevronRight, GripVertical, ListTree } from 'lucide-vue-next';
import { COLUMN_CLASS, visibleColumns, type ListColumn } from './columns';
import CellValue from './CellValue.vue';
import TaskCard from './TaskCard.vue';
import { useCardExtensions } from '../cardExtensions';
import { BlockedIcon } from '../../links';
import type { TaskField } from '../options';
import { localToday } from '../filter';
import { useBreakpoint } from '../../ui/useBreakpoint';

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
  /** subtask nesting level (0 — top) */
  depth?: number;
  /** the parent is not shown above the row (another group, subtasks hidden) — a label in the row */
  parentTitle?: string;
  /** drag handle ("Manual" sort) */
  draggable?: boolean;
  /** number of subtasks in the view; > 0 — the collapse chevron and counter */
  childCount?: number;
  /** subtasks collapsed */
  folded?: boolean;
  /** the task's project name — the "Project" column */
  projectName?: string;
  /** column widths, px (auto-size or set manually) */
  widths?: Partial<Record<ListColumn, number>>;
  /** wrap the name by words (the row grows) instead of cutting it */
  wrap?: boolean;
  /** the task key before the name */
  showKey?: boolean;
}>();
const emit = defineEmits<{
  click: [e: MouseEvent];
  drag: [e: PointerEvent];
  fold: [];
  toggle: [];
  edit: [];
  done: [];
}>();
const { t, locale } = useI18n();
const { isMobile } = useBreakpoint();
// pickers on the right are visible only on hover/focus — until then they are not mounted (project switch)
const hot = ref(false);
// the cursor left — back to the value display; while the row picker's list is open — we wait for it to close
const rowEl = ref<HTMLElement>();
let inside = false;
let wait: ReturnType<typeof setInterval> | undefined;
function enter() {
  inside = true;
  hot.value = true;
}
function leave() {
  inside = false;
  clearInterval(wait);
  const open = () => !!rowEl.value?.querySelector('[aria-expanded="true"]');
  if (!open()) return void (hot.value = false);
  wait = setInterval(() => {
    if (open()) return;
    clearInterval(wait);
    if (!inside) hot.value = false;
  }, 150);
}
onBeforeUnmount(() => clearInterval(wait));
const input = ref<HTMLInputElement>();
const draft = ref('');
let live = false; // blur after Enter/Esc does not save again

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

const columns = computed(() => visibleColumns(props.fields));
// mobile card: the enabled List fields (empty ones too — an empty icon) in the order of the Board card
const ext = useCardExtensions(() => props.task.projectId);
const cardCols = computed(() =>
  (['project', 'priority', 'dueDate', 'labels', 'assignee'] as const).filter((c) =>
    props.fields.includes(c),
  ),
);
// value frame = the picker button's frame (OptionPicker, DueDatePicker): the change on hover is not visible
const box = 'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-sm text-fg';
const labelsSet = computed(() =>
  props.task.labelIds.flatMap((id) => props.labels.find((l) => l.id === id) ?? []),
);
const people = computed(() =>
  props.task.assigneeIds.map((id) => ({
    name: props.members.find((u) => u.id === id)?.name ?? '?',
  })),
);
// overdue (before local today) — danger, today and tomorrow — warning
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
  emit('done'); // first leave edit mode: blur on unmount won't save again
  if (title && title !== props.task.title) void updateTask(props.task.id, { title });
}
</script>

<template>
  <!-- мобильная: карточка (общая с Доской) -->
  <div
    v-if="isMobile"
    role="row"
    :aria-rowindex="index"
    :aria-selected="selected"
    :data-task="task.key"
    :class="[
      'flex h-full flex-col justify-center gap-1 border-b border-border px-3 text-sm',
      // wrapped: the card grows past its height — keep the breathing room it had
      wrap ? 'min-h-16 py-2' : '',
      selected ? 'bg-accent-subtle' : '',
      focused ? 'ring-2 ring-inset ring-focus' : '',
    ]"
    @click="emit('click', $event)"
  >
    <TaskCard
      :task="task"
      :space-id="spaceId"
      :cols="cardCols"
      :blocked="blocked"
      hot
      :one-line="!wrap"
      :wrap="wrap"
      :members="members"
      :labels="labels"
      :depth="depth"
      :parent-title="parentTitle"
      :child-count="childCount"
      :project-name="projectName"
      project-text
      :show-key="showKey"
    />
  </div>
  <div
    v-else
    role="row"
    :aria-rowindex="index"
    :aria-selected="selected"
    :data-task="task.key"
    :class="[
      'group relative flex h-full items-center gap-2 border-b border-border pl-4 pr-3 text-sm',
      // wrapped: the same layout, only the name wraps; the row grows by its extra lines
      wrap ? 'min-h-8' : '',
      selected ? 'bg-accent-subtle' : 'hover:bg-bg-subtle',
      focused ? 'ring-2 ring-inset ring-focus' : '',
    ]"
    @click="emit('click', $event)"
    ref="rowEl"
    @pointerenter="enter"
    @pointerleave="leave"
    @focusin="hot = true"
  >
    <div
      v-if="draggable"
      class="absolute inset-y-0 left-0 flex w-4 cursor-grab items-center justify-center text-fg-subtle opacity-0 group-hover:opacity-100 touch-none"
      data-testid="row-grip"
      :aria-label="t('list.drag')"
      @pointerdown.stop.prevent="emit('drag', $event)"
      @click.stop
    >
      <GripVertical :size="14" />
    </div>
    <div role="gridcell" class="flex w-4 shrink-0" @click.stop>
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
    <button
      v-if="childCount"
      type="button"
      class="-mx-1 flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
      :aria-expanded="!folded"
      :aria-label="t(folded ? 'list.expand' : 'list.collapse')"
      data-testid="row-fold"
      @click.stop="emit('fold')"
    >
      <component :is="folded ? ChevronRight : ChevronDown" :size="14" />
    </button>
    <span v-else-if="childCount !== undefined" class="w-3 shrink-0" aria-hidden="true" />
    <div v-if="fields.includes('status')" role="gridcell" class="shrink-0" @click.stop>
      <StatusPicker
        compact
        :space-id="spaceId"
        :project-id="task.projectId"
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
        <span v-if="showKey" class="shrink-0 text-xs text-fg-subtle" data-testid="row-key">{{
          task.key
        }}</span>
        <span
          v-if="parentTitle"
          class="max-w-48 shrink-0 truncate text-xs text-fg-subtle"
          data-testid="row-parent"
          >{{ parentTitle }} ›</span
        >
        <span :class="wrap ? 'min-w-0 break-words' : 'truncate'" data-testid="row-title">{{
          task.title
        }}</span>
        <span
          v-if="childCount"
          class="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs text-fg-muted"
          data-testid="row-children"
          ><ListTree :size="12" />{{ childCount }}</span
        >
        <!-- поля модулей (время): видны всегда, если модуль включён -->
        <span v-for="x in ext" :key="x.key" class="ml-auto shrink-0" @click.stop>
          <component :is="x.view" :task-id="task.id" />
        </span>
      </span>
    </div>
    <!-- колонки как в ClickUp: значение в ячейке; при наведении ячейка — сам пикер (монтируется лениво) -->
    <div class="ml-auto flex shrink-0 items-center" @click.stop>
      <div
        v-for="c in columns"
        :key="c"
        role="gridcell"
        :data-col="c"
        :class="['flex h-full shrink-0 items-center overflow-hidden px-1', COLUMN_CLASS[c]]"
        :style="{ width: `${widths?.[c] ?? 112}px` }"
      >
        <!-- в покое — та же рамка, что у кнопки пикера; при наведении на её месте пикер с тем же содержимым -->
        <template v-if="(hot || focused) && c !== 'project'">
          <AssigneePicker
            v-if="c === 'assignee'"
            :space-id="spaceId"
            :model-value="task.assigneeIds"
            @update:model-value="setAssignees(task.id, $event)"
            ><template #value
              ><CellValue
                :col="c"
                :people="people"
                :due-date="task.dueDate"
                :due-tone="dueTone"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></AssigneePicker>
          <DueDatePicker
            v-else-if="c === 'dueDate'"
            :model-value="task.dueDate"
            @update:model-value="updateTask(task.id, { dueDate: $event })"
            ><template #value
              ><CellValue
                :col="c"
                :people="people"
                :due-date="task.dueDate"
                :due-tone="dueTone"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></DueDatePicker>
          <PriorityPicker
            v-else-if="c === 'priority'"
            :model-value="task.priority"
            @update:model-value="updateTask(task.id, { priority: $event })"
            ><template #value
              ><CellValue
                :col="c"
                :people="people"
                :due-date="task.dueDate"
                :due-tone="dueTone"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></PriorityPicker>
          <LabelPicker
            v-else
            :space-id="spaceId"
            :project-id="task.projectId"
            :model-value="task.labelIds"
            @update:model-value="setLabels(task.id, $event)"
            ><template #value
              ><CellValue
                :col="c"
                :people="people"
                :due-date="task.dueDate"
                :due-tone="dueTone"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></LabelPicker>
        </template>
        <span v-else :class="box">
          <CellValue
            :col="c"
            :people="people"
            :due-date="task.dueDate"
            :due-tone="dueTone"
            :priority="task.priority"
            :labels="labelsSet"
            :project="projectName"
          />
        </span>
      </div>
    </div>
  </div>
</template>
