<script setup lang="ts">
import TaskContextMenu from '../TaskContextMenu.vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { ChevronRight, MoreHorizontal } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useI18n } from 'vue-i18n';
import {
  AssigneePicker,
  DueDatePicker,
  LabelPicker,
  PriorityPicker,
  StatusPicker,
  setAssignees,
  setLabels,
  sortTasks,
  updateTask,
  useProject,
  useScopeTasks,
  useStatuses,
  type TaskView,
  useLabels,
} from '../../tasks';
import { FieldCell, FieldEditor, setTaskField, useFieldDefs } from '../../fields';
import { Button, Popover } from '../../ui';
import { openTask, useSelection, type ViewProps } from '..';
import { TASK_FIELDS, type TaskField, type ViewOptions } from '../options';
import { useTaskFilter } from '../saved/useFilter';
import { treeOrder } from '../list/tree';
import { tableColumns, type TableColumnsMenu } from './menu';
import { textWidth } from '../list/widths';
import { formatDue } from '../list/due';
import { nextSort, sortMark } from '../sortHead';
import { setStatusByName, useProjectNames, useWidenedFilter } from '../scope';
import type { SortBy } from '../../tasks';
import {
  COLUMN_IDS,
  FIELD_PREFIX,
  clampWidth,
  isFieldCol,
  loadLayout,
  moveColumn,
  newColumn,
  parseColumns,
  saveLayout,
  type ColumnId,
  type ColumnState,
  scopeLayout,
} from './columns';

const props = defineProps<ViewProps>();
const emit = defineEmits<{ 'update:options': [ViewOptions] }>();
const { t, locale } = useI18n();
const sel = useSelection();
const ROW_H = 36;
const CHECK_W = 40;

const project = useProject(() => props.projectId);
// group summary: tasks of the group's projects, reference lists of their spaces; project fields — only for a single project
const spaceId = computed(() => props.scope?.spaceIds.join(',') ?? project.value?.spaceId ?? '');
const statuses = useStatuses(spaceId);
const labels = useLabels(spaceId);
const projectNames = useProjectNames();
const all = useScopeTasks(() => props.scope?.projectIds ?? [props.projectId]);
const defs = useFieldDefs(() => (props.scope ? '' : props.projectId));
const defOf = (id: string) => defs.value?.find((d) => `${FIELD_PREFIX}${d.id}` === id);
const colName = (id: ColumnId) => (isFieldCol(id) ? (defOf(id)?.name ?? '') : t(`table.col.${id}`));
const passes = useTaskFilter(
  useWidenedFilter(() => props.filter),
  statuses,
  () => props.options.me,
);

// grouping in the table is not applied; with subtasks — a tree under the parent (sorted among siblings)
const folded = ref(new Set<string>());
const tree = computed(() => {
  const o = props.options;
  const tasks = (all.value ?? []).filter((x) => (o.showSubtasks || !x.parentId) && passes.value(x));
  const sorted = sortTasks(tasks, o.sortBy, o.sortDir);
  if (!o.showSubtasks) return sorted.map((task) => ({ task, depth: 0 }));
  const out: { task: (typeof sorted)[number]; depth: number }[] = [];
  let hideBelow = Infinity; // depth of a collapsed ancestor: rows deeper are hidden
  for (const n of treeOrder(sorted)) {
    if (n.depth > hideBelow) continue;
    hideBelow = folded.value.has(n.task.id) ? n.depth : Infinity;
    out.push(n);
  }
  return out;
});
const rows = computed(() => tree.value.map((n) => n.task));
const depthOf = computed(() => new Map(tree.value.map((n) => [n.task.id, n.depth])));
const kids = computed(() => {
  const m = new Map<string, number>();
  for (const x of all.value ?? []) if (x.parentId) m.set(x.parentId, (m.get(x.parentId) ?? 0) + 1);
  return m;
});
const toggleFold = (id: string) => {
  const f = new Set(folded.value);
  if (!f.delete(id)) f.add(id);
  folded.value = f;
};

// sorting by clicking the header: ascending → descending → manual order
const SORT_COL: Partial<Record<string, SortBy>> = {
  title: 'title',
  priority: 'priority',
  dueDate: 'dueDate',
  startDate: 'startDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};
function sortBy(id: string) {
  const by = SORT_COL[id];
  if (!by) return;
  const n = nextSort(props.options, by);
  if (props.saved) emit('update:options', { ...props.options, ...n });
  else Object.assign(props.options, n);
}
const rowIds = computed(() => rows.value.map((r) => r.id));

// --- layout
// options.columns → localStorage → default
// columns of the view's fields (status, assignee…) — by options.fields: not in fields — hidden, in fields — at the end
const isTaskField = (id: string): id is TaskField => TASK_FIELDS.includes(id as TaskField);
const withFields = (list: ColumnState[]) => [
  ...list.filter((c) => !isTaskField(c.id) || props.options.fields.includes(c.id)),
  ...props.options.fields.filter((f) => !list.some((c) => c.id === f)).map((f) => newColumn(f)),
];
const resolve = () =>
  withFields(
    parseColumns(props.options.columns) ??
      loadLayout(props.projectId, props.scope ? scopeLayout : undefined).columns,
  );
const cols = ref<ColumnState[]>(resolve());
// saved view: the edit goes to the options draft; a project tab — to localStorage
const save = () =>
  props.saved
    ? emit('update:options', { ...props.options, columns: cols.value.map((c) => ({ ...c })) })
    : saveLayout(props.projectId, { columns: cols.value });
watch(
  () => [props.projectId, JSON.stringify(props.options.columns), props.options.fields.join()],
  () => (cols.value = resolve()),
);
// auto-size (as in ClickUp): by the widest value of the column; a dragged one — its own width
const AUTO_MAX = 480;
const autoW = computed(() => {
  const st = new Map((statuses.value ?? []).map((s) => [s.id, s.name]));
  const lb = new Map((labels.value ?? []).map((l) => [l.id, l.name]));
  const m = new Map<string, number>();
  for (const c of cols.value) {
    let w = textWidth(colName(c.id)) + 52; // column menu and sort arrow
    for (const x of rows.value) {
      const v =
        c.id === 'title'
          ? textWidth(x.title) + 16 * (depthOf.value.get(x.id) ?? 0) + 28
          : c.id === 'key'
            ? textWidth(x.key, 12)
            : c.id === 'project'
              ? textWidth(projectNames.value.get(x.projectId) ?? '')
              : c.id === 'status'
                ? textWidth(st.get(x.statusId) ?? '') + 40
                : c.id === 'assignee'
                  ? 28 + 20 * Math.min(x.assigneeIds.length, 3)
                  : c.id === 'priority'
                    ? textWidth(t(`tasks.priority.${x.priority}`)) + 40
                    : c.id === 'dueDate' || c.id === 'startDate'
                      ? textWidth(
                          x[c.id] ? formatDue(x[c.id]!, locale.value) : t('taskMenu.noDue'),
                        ) + 44
                      : c.id === 'labels'
                        ? x.labelIds.reduce(
                            (s, id) => s + textWidth(lb.get(id) ?? '', 12) + 24,
                            24,
                          ) || textWidth(t('tasks.noLabel')) + 40
                        : c.id === 'createdAt' || c.id === 'updatedAt'
                          ? textWidth('2026-10-26')
                          : textWidth(String(x.fields?.[c.id.slice(FIELD_PREFIX.length)] ?? '')) +
                            24;
      if (v > w) w = v;
    }
    m.set(c.id, clampWidth(Math.min(AUTO_MAX, w + 16)));
  }
  return m;
});
const widthOf = (c: ColumnState) => (c.manual ? c.width : (autoW.value.get(c.id) ?? c.width));
const resetWidth = (c: ColumnState) => {
  c.manual = false;
  save();
};
const total = computed(() => CHECK_W + cols.value.reduce((s, c) => s + widthOf(c), 0));
// a deleted field's column drops out of the layout once the definitions are loaded
watch(defs, (ds) => {
  if (!ds) return;
  const kept = cols.value.filter((c) => !isFieldCol(c.id) || defOf(c.id));
  if (kept.length !== cols.value.length && kept.length) {
    cols.value = kept;
    save();
  }
});
const allIds = computed<ColumnId[]>(() => [
  ...COLUMN_IDS,
  ...(defs.value ?? []).map((d) => `${FIELD_PREFIX}${d.id}` as const),
]);
// the view's fields (status…) live in options.fields: the menu and «Поля» change the same list
function toggleCol(id: ColumnId, on: boolean) {
  if (!on && cols.value.length < 2) return;
  cols.value = on
    ? [...cols.value.filter((c) => c.id !== id), newColumn(id)]
    : cols.value.filter((c) => c.id !== id);
  const columns = cols.value.map((c) => ({ ...c }));
  const fields = !isTaskField(id)
    ? props.options.fields
    : on
      ? [...props.options.fields.filter((f) => f !== id), id]
      : props.options.fields.filter((f) => f !== id);
  if (props.saved) emit('update:options', { ...props.options, columns, fields });
  else {
    saveLayout(props.projectId, { columns: cols.value });
    props.options.fields = fields;
  }
}
const menu: TableColumnsMenu = {
  items: computed(() =>
    allIds.value.map((id) => ({
      id,
      label: colName(id),
      on: cols.value.some((c) => c.id === id),
      locked: cols.value.length === 1 && cols.value[0]!.id === id,
    })),
  ),
  toggle: (id, on) => toggleCol(id as ColumnId, on),
};
tableColumns.value = menu;
onBeforeUnmount(() => {
  if (tableColumns.value === menu) tableColumns.value = null;
});
function move(i: number, to: number) {
  cols.value = moveColumn(cols.value, i, to);
  save();
}
function startResize(c: ColumnState, e: PointerEvent) {
  const x0 = e.clientX;
  const w0 = widthOf(c);
  const onMove = (m: PointerEvent) => {
    c.width = clampWidth(w0 + m.clientX - x0);
    c.manual = true;
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    save();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// --- virtualization
const scroller = ref<HTMLElement>();
const virt = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => ROW_H,
    overscan: 8,
    getItemKey: (i: number) => rows.value[i]?.id ?? i,
  })),
);
const measure = (el: unknown) => virt.value.measureElement(el as Element | null);
// sizes measured with wrapping are stale without it (and back)
watch(
  () => props.options.wrapTitles,
  () => virt.value.measure(),
);

// --- editing
const editing = ref<string | null>(null);
const draft = ref('');
let live = false; // blur after Enter/Esc does not save again
async function startEdit(task: TaskView) {
  editing.value = task.id;
  draft.value = task.title;
  live = true;
  await nextTick();
  const i = scroller.value?.querySelector<HTMLInputElement>('[data-edit]');
  i?.focus();
  i?.select();
}
function saveTitle(task: TaskView) {
  if (!live) return;
  live = false;
  editing.value = null;
  const title = draft.value.trim();
  if (title && title !== task.title) void updateTask(task.id, { title });
}
function cancelEdit() {
  live = false;
  editing.value = null;
}

function onCheck(task: TaskView, e: MouseEvent) {
  if (e.shiftKey) sel.range(rowIds.value, task.id);
  else sel.toggle(task.id);
}

// --- bulk edit: one mutation per task
const each = (f: (x: TaskView) => Promise<unknown>) =>
  Promise.all((all.value ?? []).filter((x) => sel.selected.value.has(x.id)).map(f));

// --- fields: cell edit and bulk edit
const editCell = ref<string | null>(null); // `${taskId}|${columnId}`
function saveCell(task: TaskView, id: string, v: unknown) {
  editCell.value = null;
  void setTaskField(task.id, id.slice(FIELD_PREFIX.length), v);
}
const bulkId = ref('');
const bulkDef = computed(() => (defs.value ?? []).find((d) => d.id === bulkId.value));

const date = (v: string) => v.slice(0, 10);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <TaskContextMenu :space-id="spaceId" :tasks="all">
      <div
        ref="scroller"
        role="grid"
        tabindex="0"
        :aria-rowcount="rows.length + 1"
        class="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 ring-inset ring-focus"
      >
        <div :style="{ width: `${total}px`, minWidth: '100%' }">
          <VueDraggable
            :model-value="cols"
            role="row"
            class="sticky top-0 z-10 flex h-9 border-b border-border bg-bg-muted text-sm font-medium"
            filter=".no-drag"
            draggable="[role=columnheader]"
            :prevent-on-filter="false"
            @update="
              // indexes among the headers: space for the checkboxes in front is not counted
              (e: { oldDraggableIndex?: number; newDraggableIndex?: number }) =>
                move(e.oldDraggableIndex ?? 0, e.newDraggableIndex ?? 0)
            "
          >
            <div :style="{ width: `${CHECK_W}px` }" class="no-drag shrink-0 px-3 py-2.5">
              <input
                type="checkbox"
                :checked="sel.state(rowIds) === 'all'"
                :indeterminate="sel.state(rowIds) === 'some'"
                :aria-label="t('table.selectAll')"
                class="size-4"
                data-testid="select-all"
                @click="sel.toggleAll(rowIds)"
              />
            </div>
            <div
              v-for="(c, i) in cols"
              :key="c.id"
              role="columnheader"
              :data-col="c.id"
              :style="{ width: `${widthOf(c)}px` }"
              class="relative flex shrink-0 items-center gap-1 px-2"
              :aria-sort="
                sortMark(options, SORT_COL[c.id]) === '↑'
                  ? 'ascending'
                  : sortMark(options, SORT_COL[c.id]) === '↓'
                    ? 'descending'
                    : undefined
              "
            >
              <button
                v-if="SORT_COL[c.id]"
                type="button"
                class="min-w-0 truncate rounded-sm text-left outline-none hover:text-fg focus-visible:ring-2 ring-focus"
                :title="t('table.sortBy')"
                data-testid="col-sort"
                @click="sortBy(c.id)"
              >
                {{ colName(c.id) }}
                <span class="text-accent">{{ sortMark(options, SORT_COL[c.id]) }}</span>
              </button>
              <span v-else class="truncate">{{ colName(c.id) }}</span>
              <Popover align="start">
                <template #trigger>
                  <button
                    type="button"
                    :aria-label="t('table.columnMenu', { name: colName(c.id) })"
                    class="no-drag ml-auto inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-bg-subtle focus-visible:ring-2 ring-focus"
                  >
                    <MoreHorizontal :size="14" aria-hidden="true" />
                  </button>
                </template>
                <div class="flex flex-col gap-1">
                  <Button size="sm" :disabled="i === 0" @click="move(i, i - 1)">{{
                    t('table.left')
                  }}</Button>
                  <Button size="sm" :disabled="i === cols.length - 1" @click="move(i, i + 1)">{{
                    t('table.right')
                  }}</Button>
                  <Button size="sm" :disabled="cols.length === 1" @click="toggleCol(c.id, false)">{{
                    t('table.hide')
                  }}</Button>
                </div>
              </Popover>
              <div
                role="separator"
                aria-orientation="vertical"
                :aria-label="t('table.resize')"
                class="no-drag absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent-subtle"
                @pointerdown.prevent.stop="startResize(c, $event)"
                @dblclick.stop="resetWidth(c)"
              />
            </div>
          </VueDraggable>

          <p v-if="all && !rows.length" class="p-6 text-center text-fg-muted">
            {{ t('table.empty') }}
          </p>
          <div class="relative" :style="{ height: `${virt.getTotalSize()}px` }">
            <!-- wrapped names: a row is as tall as its content, the virtualizer measures it (as in the List) -->
            <div
              v-for="v in virt.getVirtualItems()"
              :key="String(v.key)"
              :ref="options.wrapTitles ? measure : undefined"
              :data-index="v.index"
              class="absolute left-0 top-0 w-full"
              :style="{
                ...(options.wrapTitles ? { minHeight: `${ROW_H}px` } : { height: `${v.size}px` }),
                transform: `translateY(${v.start}px)`,
              }"
            >
              <template v-for="task in [rows[v.index]]" :key="task?.id">
                <div
                  v-if="task"
                  role="row"
                  :aria-rowindex="v.index + 2"
                  :aria-selected="sel.selected.value.has(task.id)"
                  :data-task="task.key"
                  :class="[
                    'flex h-full min-h-9 items-center border-b border-border text-sm',
                    sel.selected.value.has(task.id) ? 'bg-accent-subtle' : 'hover:bg-bg-subtle',
                  ]"
                >
                  <div role="gridcell" :style="{ width: `${CHECK_W}px` }" class="shrink-0 px-3">
                    <input
                      type="checkbox"
                      :checked="sel.selected.value.has(task.id)"
                      :aria-label="t('table.select')"
                      class="size-4"
                      @click="onCheck(task, $event)"
                    />
                  </div>
                  <div
                    v-for="c in cols"
                    :key="c.id"
                    role="gridcell"
                    :data-col="c.id"
                    :style="{ width: `${widthOf(c)}px` }"
                    class="min-w-0 shrink-0 px-2"
                    :class="{
                      'self-stretch': isFieldCol(c.id),
                      truncate: !(options.wrapTitles && c.id === 'title'),
                      'py-1.5': options.wrapTitles && c.id === 'title',
                    }"
                  >
                    <template v-if="c.id === 'title'">
                      <input
                        v-if="editing === task.id"
                        v-model="draft"
                        data-edit
                        :aria-label="t('table.editTitle')"
                        class="h-7 w-full rounded-md border border-border-strong bg-bg px-2 text-sm outline-none focus-visible:ring-2 ring-focus"
                        @keydown.enter.prevent="saveTitle(task)"
                        @keydown.esc.stop.prevent="cancelEdit"
                        @blur="saveTitle(task)"
                      />
                      <div
                        v-else
                        class="flex min-w-0 items-center gap-1"
                        :style="{ paddingLeft: `${16 * (depthOf.get(task.id) ?? 0)}px` }"
                      >
                        <button
                          v-if="options.showSubtasks && kids.get(task.id)"
                          type="button"
                          :aria-label="t(folded.has(task.id) ? 'list.expand' : 'list.collapse')"
                          :aria-expanded="!folded.has(task.id)"
                          data-testid="table-fold"
                          class="shrink-0 rounded-sm text-fg-muted hover:text-fg"
                          @click="toggleFold(task.id)"
                        >
                          <ChevronRight
                            :size="14"
                            :class="['transition-transform', !folded.has(task.id) && 'rotate-90']"
                          />
                        </button>
                        <div v-else-if="options.showSubtasks" class="w-3.5 shrink-0" />
                        <span
                          tabindex="0"
                          :class="[
                            'block outline-none focus-visible:ring-2 ring-focus',
                            options.wrapTitles ? 'min-w-0 break-words' : 'truncate',
                          ]"
                          @dblclick="startEdit(task)"
                          @keydown.enter.prevent="startEdit(task)"
                          >{{ task.title }}</span
                        >
                      </div>
                    </template>
                    <span v-else-if="c.id === 'project'" class="block truncate text-fg-muted">{{
                      projectNames.get(task.projectId) ?? ''
                    }}</span>
                    <button
                      v-else-if="c.id === 'key'"
                      type="button"
                      class="text-xs text-fg-subtle underline-offset-2 outline-none hover:underline focus-visible:ring-2 ring-focus"
                      @click="openTask(task.key)"
                    >
                      {{ task.key }}
                    </button>
                    <StatusPicker
                      v-else-if="c.id === 'status'"
                      :space-id="task.spaceId"
                      :project-id="task.projectId"
                      :model-value="task.statusId"
                      @update:model-value="updateTask(task.id, { statusId: $event })"
                    />
                    <AssigneePicker
                      v-else-if="c.id === 'assignee'"
                      compact
                      :space-id="task.spaceId"
                      :model-value="task.assigneeIds"
                      @update:model-value="setAssignees(task.id, $event)"
                    />
                    <PriorityPicker
                      v-else-if="c.id === 'priority'"
                      :model-value="task.priority"
                      @update:model-value="updateTask(task.id, { priority: $event })"
                    />
                    <DueDatePicker
                      v-else-if="c.id === 'dueDate'"
                      :model-value="task.dueDate"
                      @update:model-value="updateTask(task.id, { dueDate: $event })"
                    />
                    <DueDatePicker
                      v-else-if="c.id === 'startDate'"
                      :model-value="task.startDate"
                      @update:model-value="updateTask(task.id, { startDate: $event })"
                    />
                    <LabelPicker
                      v-else-if="c.id === 'labels'"
                      :space-id="task.spaceId"
                      :project-id="task.projectId"
                      :model-value="task.labelIds"
                      @update:model-value="setLabels(task.id, $event)"
                    />
                    <template v-else-if="isFieldCol(c.id)">
                      <div
                        v-if="defOf(c.id) && editCell === `${task.id}|${c.id}`"
                        @keydown.esc.stop.prevent="editCell = null"
                      >
                        <FieldEditor
                          :def="defOf(c.id)!"
                          :value="task.fields?.[defOf(c.id)!.id]"
                          :space-id="task.spaceId"
                          @update:value="saveCell(task, c.id, $event)"
                        />
                      </div>
                      <span
                        v-else-if="defOf(c.id)"
                        tabindex="0"
                        class="flex h-full w-full items-center outline-none focus-visible:ring-2 ring-focus"
                        @dblclick="editCell = `${task.id}|${c.id}`"
                        @keydown.enter.prevent="editCell = `${task.id}|${c.id}`"
                      >
                        <FieldCell :def="defOf(c.id)!" :value="task.fields?.[defOf(c.id)!.id]" />
                      </span>
                    </template>
                    <span v-else class="text-fg-muted">{{
                      date(c.id === 'createdAt' ? task.createdAt : task.updatedAt)
                    }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </TaskContextMenu>

    <div
      v-if="sel.selected.value.size"
      role="toolbar"
      :aria-label="t('table.selected', { n: sel.selected.value.size })"
      class="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-3 py-2 text-sm"
    >
      <span>{{ t('table.selected', { n: sel.selected.value.size }) }}</span>
      <StatusPicker
        :space-id="spaceId"
        @update:model-value="each((x) => setStatusByName(statuses ?? [], x, $event))"
      />
      <PriorityPicker @update:model-value="each((x) => updateTask(x.id, { priority: $event }))" />
      <AssigneePicker
        :space-id="spaceId"
        @update:model-value="
          each((x) => setAssignees(x.id, [...new Set([...x.assigneeIds, ...$event])]))
        "
      />
      <DueDatePicker @update:model-value="each((x) => updateTask(x.id, { dueDate: $event }))" />
      <template v-if="defs?.length">
        <select
          v-model="bulkId"
          :aria-label="t('table.bulkField')"
          data-bulk-field
          class="h-8 rounded-md border border-border-strong bg-bg px-2 text-sm"
        >
          <option value="">{{ t('table.bulkField') }}</option>
          <option v-for="d in defs" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
        <FieldEditor
          v-if="bulkDef"
          :key="bulkDef.id"
          :def="bulkDef"
          :space-id="spaceId"
          @update:value="each((x) => setTaskField(x.id, bulkDef!.id, $event))"
        />
      </template>
      <Button size="sm" @click="sel.clear()">{{ t('table.clear') }}</Button>
    </div>
  </div>
</template>
