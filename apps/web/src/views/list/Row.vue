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
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-vue-next';
import { COLUMN_CLASS, NARROW_ORDER, visibleColumns, type ListColumn } from './columns';
import CellValue from './CellValue.vue';
import TaskCard from './TaskCard.vue';
import { useCardExtensions } from '../cardExtensions';
import AiCell from './AiCell.vue';
import TaskProgress from '../TaskProgress.vue';
import TaskAiStatus from '../TaskAiStatus.vue';
import { BlockedIcon } from '../../links';
import { isAiField, type TaskField } from '../options';
import { localToday } from '../filter';
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
  /** the Cards view: a card on desktop too */
  cards?: boolean;
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
  <!-- мобильная и вид «Карточки»: карточка (общая с Доской) -->
  <div
    v-if="isMobile || cards"
    ref="rowEl"
    role="row"
    :aria-rowindex="index"
    :aria-selected="selected"
    :data-task="task.key"
    :data-task-id="task.id"
    :class="[
      'group flex h-full items-center gap-1 border-b border-border py-2 pl-3 text-sm',
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
    <label
      v-if="selecting"
      role="gridcell"
      class="-ml-3 flex size-11 shrink-0 items-center justify-center"
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
    <!-- PLNRAPP-706: на мобильной название целиком (переносится по словам), строку меряет виртуализатор -->
    <div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
      <TaskCard
        :task="task"
        :space-id="spaceId"
        :cols="cardCols"
        :blocked="blocked"
        :hot="isMobile || hot || focused"
        :one-line="!wrap && !isMobile"
        :wrap="wrap || isMobile"
        :members="members"
        :labels="labels"
        :depth="depth"
        :parent="parent"
        :project-name="projectName"
        project-text
        :head="isMobile"
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
      // PLNRAPP-705: the list area is narrow (the task sidebar, a small window) — two lines:
      // the name over the full width, below it the parent, labels, assignees, dates, other columns, icons
      'list-narrow:min-h-8 list-narrow:flex-wrap list-narrow:gap-y-0.5 list-narrow:py-1',
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
    <!-- узкий режим: ячейка и её строка — contents, их элементы раскладывает строка (order) -->
    <div role="gridcell" class="min-w-0 flex-1 list-narrow:contents" @dblclick.stop="emit('edit')">
      <textarea
        v-if="editing"
        ref="input"
        v-model="draft"
        rows="1"
        :aria-label="t('list.editTitle')"
        class="block w-full resize-none overflow-hidden rounded-md border border-border-strong bg-bg px-2 py-1 text-sm leading-[18px] outline-none focus-visible:ring-2 ring-focus list-narrow:w-auto list-narrow:min-w-0 list-narrow:flex-1"
        @click.stop
        @keydown.enter.prevent="save"
        @keydown.esc.stop.prevent="((live = false), emit('done'))"
        @blur="save"
      />
      <span v-else class="flex items-center gap-1 list-narrow:contents">
        <!-- PLNRAPP-704: значок ИИ (работает / ошибка), как у карточки; при колонке «ИИ» — в ней -->
        <TaskAiStatus v-if="!columns.includes('ai')" :task="task" @click.stop @dblclick.stop />
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
             глубокое дерево ужимает обоих, но родитель не уже ключа (min-w-20), а название не уходит в ноль -->
        <span
          v-if="parent"
          class="flex min-w-20 max-w-48 items-center gap-1 overflow-hidden text-xs text-fg-subtle list-narrow:order-3"
          :title="`${parent.key} ${parent.title}`"
          data-testid="row-parent"
          ><span class="shrink-0">{{ parent.key }}</span
          ><span class="min-w-0 truncate">{{ parent.title }}</span
          ><span class="shrink-0">›</span></span
        >
        <!-- узкий режим: название на всю первую строку и переносится по словам, не обрезается -->
        <span
          :class="['min-w-0 break-words list-narrow:flex-1', !wrap && 'list-wide:truncate']"
          data-testid="row-title"
          >{{ task.title }}</span
        >
        <!-- PLNRAPP-333: subtasks / checklist «closed/total» (all subtasks, not only those in the view); PLNRAPP-577: assigned comments -->
        <span
          class="contents list-narrow:order-8 list-narrow:flex list-narrow:items-center list-narrow:gap-1"
          ><TaskProgress :task-id="task.id" :comments="task"
        /></span>
        <!-- поля модулей (время): видны всегда, если модуль включён -->
        <span
          v-for="x in ext"
          :key="x.key"
          class="ml-auto shrink-0 list-narrow:order-8 list-narrow:ml-0"
          @click.stop
        >
          <component :is="x.view" :task-id="task.id" />
        </span>
      </span>
    </div>
    <!-- колонки как в ClickUp: значение в ячейке; при наведении ячейка — сам пикер (монтируется лениво) -->
    <!-- узкий режим: перенос на вторую строку с отступом под глубину дерева;
         обёртка колонок — contents, ячейки встают в порядок второй строки (NARROW_ORDER) -->
    <span class="hidden h-0 basis-full list-narrow:order-2 list-narrow:block" aria-hidden="true" />
    <span
      class="hidden shrink-0 list-narrow:order-2 list-narrow:block"
      :style="{ width: `${16 + (depth ?? 0) * 20}px` }"
      aria-hidden="true"
    />
    <div
      class="ml-auto flex shrink-0 items-center list-narrow:contents"
      data-testid="row-cols"
      @click.stop
    >
      <div
        v-for="c in columns"
        :key="c"
        role="gridcell"
        :data-col="c"
        :class="[
          'flex h-full shrink-0 items-center overflow-hidden px-1',
          'list-narrow:flex! list-narrow:h-auto list-narrow:max-w-full list-narrow:w-auto!',
          COLUMN_CLASS[c],
          NARROW_ORDER[c],
        ]"
        :style="{ width: `${widths?.[c] ?? 112}px` }"
      >
        <!-- в покое — та же рамка, что у кнопки пикера; при наведении на её месте пикер с тем же содержимым -->
        <AiCell v-if="isAiField(c)" :task="task" :col="c as 'ai'" />
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
                :due-date="task.dueDate"
                :due-tone="dueTone"
                :priority="task.priority"
                :labels="labelsSet"
                :project="projectName" /></template
          ></AssigneePicker>
          <DueDatePicker
            v-else-if="c === 'dueDate'"
            :task-id="task.id"
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
    <button
      type="button"
      :class="[
        menuBtn,
        'size-7 focus-visible:opacity-100 group-hover:opacity-100 list-narrow:order-1',
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
