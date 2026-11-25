<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AssigneePicker,
  PriorityPicker,
  LabelPicker,
  StatusPicker,
  TaskDatesPicker,
  setAssignees,
  setLabels,
  updateTask,
  type TaskView,
} from '../../tasks';
import type { Row as DbRow } from '@planar/shared';
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-vue-next';
import { COLUMN_CLASS, visibleColumns, type ListColumn } from './columns';
import CellValue from './CellValue.vue';
import TaskCard from './TaskCard.vue';
import { useCardExtensions } from '../cardExtensions';
import AiCell from './AiCell.vue';
import TaskProgress from '../TaskProgress.vue';
import { BlockedIcon } from '../../links';
import { isAiField, type TaskField } from '../options';
import { useBreakpoint } from '../../ui/useBreakpoint';
import { toast } from '../../ui/toast';

const props = defineProps<{
  task: TaskView;
  spaceId: string;
  index: number;
  selected: boolean;
  /** selection mode (PLNRAPP-291): the checkbox is shown only in it (desktop) */
  selecting?: boolean;
  focused: boolean;
  editing: boolean;
  fields: TaskField[];
  blocked: boolean;
  members: DbRow<'users'>[];
  labels: DbRow<'labels'>[];
  /** subtask nesting level (0 — top) */
  depth?: number;
  /** the parent is not shown above the row (another group, subtasks hidden) — a label in the row */
  parent?: { key: string; title: string; statusId?: string; projectId?: string };
  /** drag handle ("Manual" sort) */
  draggable?: boolean;
  /** number of subtasks in the view; > 0 — the collapse chevron */
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
  /** mobile card: tag names instead of tag icons */
  labelNames?: boolean;
  /** the list area is narrow (the task sidebar, a small window) — the row is a card, as on mobile */
  narrow?: boolean;
  /** the card: empty fields too (the "Show empty fields" option) */
  showEmpty?: boolean;
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
// click on the key — copy it (PLNRAPP-181)
const copyKey = () =>
  void navigator.clipboard
    ?.writeText(props.task.key)
    .then(() => toast(t('taskMenu.idCopied'), 2500));
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
const input = ref<HTMLTextAreaElement>();
const draft = ref('');
let live = false; // blur after Enter/Esc does not save again
// textarea height follows the text: a long name is edited in several lines
watch([draft, input], async () => {
  await nextTick();
  const el = input.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
});

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

const ext = useCardExtensions(() => props.task.projectId);
const columns = computed(() => visibleColumns(props.fields));
const asCard = computed(() => isMobile.value || props.narrow);
// branches / MR / CI (module badges) — the Git column; the rest (time) — after the name
const badges = computed(() => ext.value.filter((x) => x.badge));
const extFields = computed(() => ext.value.filter((x) => !x.badge));
// mobile card: the enabled List fields (empty ones too — an empty icon) in the order of the Board card
const cardCols = computed(() =>
  (['project', 'priority', 'dueDate', 'labels', 'assignee'] as const).filter(
    (c) => props.fields.includes(c) && (props.showEmpty || filled(c)),
  ),
);
// value frame = the picker button's frame (OptionPicker, TaskDatesPicker): the change on hover is not visible
const box = 'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-sm text-fg';
const labelsSet = computed(() =>
  props.task.labelIds.flatMap((id) => props.labels.find((l) => l.id === id) ?? []),
);
const filled = (c: 'project' | 'priority' | 'dueDate' | 'labels' | 'assignee') =>
  c === 'project' ||
  (c === 'priority'
    ? !!props.task.priority
    : c === 'dueDate'
      ? !!(props.task.dueDate || props.task.startDate)
      : c === 'assignee'
        ? props.task.assigneeIds.length > 0
        : labelsSet.value.length > 0);
const people = computed(() =>
  props.task.assigneeIds.map((id) => ({
    name: props.members.find((u) => u.id === id)?.name ?? '?',
  })),
);

// «…» (PLNRAPP-139): the view's context menu (TaskContextMenu), opened at the button;
// a plain button, not IconButton — no tooltip per virtualized row
const menuBtn =
  'flex shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg outline-none focus-visible:ring-2 ring-focus';
function openMenu(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: r.left,
      clientY: r.bottom,
    }),
  );
}

function save() {
  if (!live) return;
  live = false;
  const title = draft.value.replace(/\s*\n\s*/g, ' ').trim(); // a pasted line break — a space
  emit('done'); // first leave edit mode: blur on unmount won't save again
  if (title && title !== props.task.title) void updateTask(props.task.id, { title });
}
</script>

<template>
  <!-- мобильная и узкая область: компактная карточка (общая с Доской); PLNRAPP-802: отступ 4 px сверху и снизу, 8 px слева -->
  <div
    v-if="asCard"
    ref="rowEl"
    role="row"
    :aria-rowindex="index"
    :aria-selected="selected"
    :data-task="task.key"
    :data-task-id="task.id"
    :class="[
      'group relative flex h-full items-start gap-1 border-b border-border py-1 pl-2 text-sm',
      isMobile ? 'pr-3' : 'pr-1',
      selected ? 'bg-accent-subtle' : !isMobile && 'hover:bg-bg-subtle',
      focused ? 'ring-2 ring-inset ring-focus' : '',
    ]"
    @click="emit('click', $event)"
    @pointerenter="enter"
    @pointerleave="leave"
    @focusin="hot = true"
  >
    <!-- PLNRAPP-281: чекбокс в режиме выбора (первую задачу выбирают пунктом «Выбрать» меню), зона касания 44px -->
    <div
      v-if="draggable && !isMobile"
      class="absolute inset-y-0 left-0 flex w-2 cursor-grab items-center justify-center text-fg-subtle opacity-0 group-hover:opacity-100 touch-none"
      data-testid="row-grip"
      :aria-label="t('list.drag')"
      @pointerdown.stop.prevent="emit('drag', $event)"
      @click.stop
    >
      <GripVertical :size="12" />
    </div>
    <label
      v-if="selecting"
      role="gridcell"
      :class="[
        'flex shrink-0 items-center justify-center',
        isMobile ? '-ml-2 size-11 self-center' : 'h-7 w-5',
      ]"
      data-testid="row-select"
      @click.stop
    >
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="t('list.select')"
        class="size-4"
        @change="emit('toggle')"
      />
    </label>
    <span v-if="depth" class="shrink-0" :style="{ width: `${depth * 12}px` }" aria-hidden="true" />
    <button
      v-if="childCount"
      type="button"
      class="flex h-7 w-4 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
      :aria-expanded="!folded"
      :aria-label="t(folded ? 'list.expand' : 'list.collapse')"
      data-testid="row-fold"
      @click.stop="emit('fold')"
    >
      <component :is="folded ? ChevronRight : ChevronDown" :size="14" />
    </button>
    <!-- PLNRAPP-706: название целиком (переносится по словам), строку меряет виртуализатор -->
    <div class="flex min-w-0 flex-1 flex-col justify-center">
      <TaskCard
        :task="task"
        :space-id="spaceId"
        :cols="cardCols"
        :blocked="blocked"
        :hot="isMobile || hot || focused"
        :wrap="wrap"
        :show-key="showKey"
        :members="members"
        :labels="labels"
        :parent="parent"
        :project-name="projectName"
        project-text
        head
        :ai="fields.includes('ai')"
        :git="fields.includes('git')"
        :label-names="labelNames"
      />
    </div>
    <!-- mobile: no «…» — the menu by a long press on the card -->
    <button
      v-if="!isMobile"
      type="button"
      :class="[
        menuBtn,
        'size-7 self-start focus-visible:opacity-100 group-hover:opacity-100',
        !focused && 'opacity-0',
      ]"
      :aria-label="t('list.actions')"
      data-testid="row-menu"
      @click.stop="openMenu"
    >
      <MoreHorizontal :size="16" />
    </button>
  </div>
  <div
    v-else
    role="row"
    :aria-rowindex="index"
    :aria-selected="selected"
    :data-task="task.key"
    :data-task-id="task.id"
    :class="[
      'group relative flex h-full items-center gap-2 border-b border-border pl-4 pr-3 text-sm',
      // wrapped or being edited: the same layout, the row grows by the name's extra lines
      wrap || editing ? 'min-h-8' : '',
      editing ? 'py-0.5' : '',
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
        v-if="selecting"
        type="checkbox"
        :checked="selected"
        :aria-label="t('list.select')"
        class="size-4"
        data-testid="row-check"
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
    <div
      v-if="fields.includes('status')"
      role="gridcell"
      data-col="status"
      class="shrink-0"
      @click.stop
    >
      <StatusPicker
        compact
        :space-id="spaceId"
        :project-id="task.projectId"
        :model-value="task.statusId"
        @update:model-value="updateTask(task.id, { statusId: $event })"
      />
    </div>
    <div role="gridcell" class="min-w-0 flex-1" @dblclick.stop="emit('edit')">
      <textarea
        v-if="editing"
        ref="input"
        v-model="draft"
        rows="1"
        :aria-label="t('list.editTitle')"
        class="block w-full resize-none overflow-hidden rounded-md border border-border-strong bg-bg px-2 py-1 text-sm leading-[18px] outline-none focus-visible:ring-2 ring-focus"
        @click.stop
        @keydown.enter.prevent="save"
        @keydown.esc.stop.prevent="((live = false), emit('done'))"
        @blur="save"
      />
      <span v-else class="flex items-center gap-1">
        <BlockedIcon v-if="blocked" />
        <button
          v-if="showKey"
          type="button"
          class="shrink-0 cursor-copy text-xs text-fg-subtle underline-offset-2 outline-none hover:underline focus-visible:ring-2 ring-focus"
          :title="t('task.copyKey')"
          data-testid="row-key"
          @click.stop="copyKey"
          @dblclick.stop
        >
          {{ task.key }}
        </button>
        <!-- PLNRAPP-704: родитель, как в карточке, — ключ и название;
             PLNRAPP-705: место под родителя и название в одной строке держит порог узкого режима (View.vue);
             глубокое дерево ужимает обоих, но родитель не уже ключа (min-w-20), а название не уходит в ноль;
             значок ИИ — в колонке «ИИ», ветки/MR/CI — в колонке «Git» -->
        <span
          v-if="parent"
          class="flex min-w-20 max-w-48 items-center gap-1 overflow-hidden text-xs text-fg-subtle"
          :title="`${parent.key} ${parent.title}`"
          data-testid="row-parent"
          ><span class="shrink-0">{{ parent.key }}</span
          ><span class="min-w-0 truncate">{{ parent.title }}</span
          ><span class="shrink-0">›</span></span
        >
        <span :class="['min-w-0 break-words', !wrap && 'truncate']" data-testid="row-title">{{
          task.title
        }}</span>
        <!-- PLNRAPP-333: subtasks / checklist «closed/total» (all subtasks, not only those in the view); PLNRAPP-577: assigned comments -->
        <TaskProgress :task-id="task.id" :comments="task" />
        <!-- поля модулей (время): видны всегда, если модуль включён -->
        <span v-for="x in extFields" :key="x.key" class="ml-auto shrink-0" @click.stop>
          <component :is="x.view" :task-id="task.id" />
        </span>
      </span>
    </div>
    <!-- колонки как в ClickUp: значение в ячейке; при наведении ячейка — сам пикер (монтируется лениво) -->
    <div class="ml-auto flex shrink-0 items-center" data-testid="row-cols" @click.stop>
      <div
        v-for="c in columns"
        :key="c"
        role="gridcell"
        :data-col="c"
        :class="['flex h-full shrink-0 items-center overflow-hidden px-1', COLUMN_CLASS[c]]"
        :style="{ width: `${widths?.[c] ?? 112}px` }"
      >
        <!-- в покое — та же рамка, что у кнопки пикера; при наведении на её месте пикер с тем же содержимым -->
        <AiCell v-if="isAiField(c)" :task="task" :col="c as 'ai'" />
        <span v-else-if="c === 'git'" class="flex items-center gap-1"
          ><component :is="x.view" v-for="x in badges" :key="x.key" :task-id="task.id"
        /></span>
        <template v-else-if="(hot || focused) && c !== 'project'">
          <AssigneePicker
            v-if="c === 'assignee'"
            :space-id="spaceId"
            :model-value="task.assigneeIds"
            @update:model-value="setAssignees(task.id, $event)"
            ><template #value
              ><CellValue
                :col="c"
                :people="people"
                :start-date="task.startDate"
                :due-date="task.dueDate"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></AssigneePicker>
          <TaskDatesPicker
            v-else-if="c === 'dueDate'"
            :task-id="task.id"
            :start="task.startDate"
            :due="task.dueDate"
            @update:start="(v: string | null) => updateTask(task.id, { startDate: v })"
            @update:due="(v: string | null) => updateTask(task.id, { dueDate: v })"
            ><template #value
              ><CellValue
                :col="c"
                :people="people"
                :start-date="task.startDate"
                :due-date="task.dueDate"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></TaskDatesPicker>
          <PriorityPicker
            v-else-if="c === 'priority'"
            :model-value="task.priority"
            @update:model-value="updateTask(task.id, { priority: $event })"
            ><template #value
              ><CellValue
                :col="c"
                :people="people"
                :start-date="task.startDate"
                :due-date="task.dueDate"
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
                :start-date="task.startDate"
                :due-date="task.dueDate"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></LabelPicker>
        </template>
        <span v-else :class="box">
          <CellValue
            :col="c"
            :people="people"
            :start-date="task.startDate"
            :due-date="task.dueDate"
            :priority="task.priority"
            :labels="labelsSet"
            :project="projectName"
          />
        </span>
      </div>
    </div>
    <button
      type="button"
      :class="[
        menuBtn,
        'size-7 focus-visible:opacity-100 group-hover:opacity-100',
        !focused && 'opacity-0',
      ]"
      :aria-label="t('list.actions')"
      :title="t('list.actions')"
      data-testid="row-menu"
      @click.stop="openMenu"
    >
      <MoreHorizontal :size="16" />
    </button>
  </div>
</template>
