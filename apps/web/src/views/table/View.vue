<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import { MoreHorizontal } from 'lucide-vue-next';
import { computed, nextTick, ref, watch } from 'vue';
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
  useProjectTasks,
  useStatuses,
  type TaskView,
} from '../../tasks';
import { FieldCell, FieldEditor, setTaskField, useFieldDefs } from '../../fields';
import { Button, Popover } from '../../ui';
import { openTask, useSelection, type ViewProps } from '..';
import { useTaskFilter } from '../saved/useFilter';
import {
  COLUMN_IDS,
  FIELD_PREFIX,
  clampWidth,
  isFieldCol,
  loadLayout,
  moveColumn,
  newColumn,
  saveLayout,
  type ColumnId,
  type ColumnState,
} from './columns';

const props = defineProps<ViewProps>();
const { t } = useI18n();
const sel = useSelection();
const ROW_H = 36;
const CHECK_W = 40;

const project = useProject(() => props.projectId);
const spaceId = computed(() => project.value?.spaceId ?? '');
const statuses = useStatuses(spaceId);
const all = useProjectTasks(() => props.projectId);
const defs = useFieldDefs(() => props.projectId);
const defOf = (id: string) => defs.value?.find((d) => `${FIELD_PREFIX}${d.id}` === id);
const colName = (id: ColumnId) => (isFieldCol(id) ? (defOf(id)?.name ?? '') : t(`table.col.${id}`));
const passes = useTaskFilter(() => props.filter, statuses);

// группировка в таблице не применяется
const rows = computed(() => {
  const o = props.options;
  const tasks = (all.value ?? []).filter((x) => (o.showSubtasks || !x.parentId) && passes.value(x));
  return sortTasks(tasks, o.sortBy, o.sortDir);
});
const rowIds = computed(() => rows.value.map((r) => r.id));

// --- раскладка
const cols = ref<ColumnState[]>(loadLayout(props.projectId).columns);
const save = () => saveLayout(props.projectId, { columns: cols.value });
watch(
  () => props.projectId,
  (p) => (cols.value = loadLayout(p).columns),
);
const total = computed(() => CHECK_W + cols.value.reduce((s, c) => s + c.width, 0));
// колонка удалённого поля выпадает из раскладки, когда определения загружены
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
const hidden = computed(() => allIds.value.filter((id) => !cols.value.some((c) => c.id === id)));
function toggleCol(id: ColumnId, on: boolean) {
  if (on) cols.value = [...cols.value, newColumn(id)];
  else if (cols.value.length > 1) cols.value = cols.value.filter((c) => c.id !== id);
  save();
}
function move(i: number, to: number) {
  cols.value = moveColumn(cols.value, i, to);
  save();
}
function startResize(c: ColumnState, e: PointerEvent) {
  const x0 = e.clientX;
  const w0 = c.width;
  const onMove = (m: PointerEvent) => {
    c.width = clampWidth(w0 + m.clientX - x0);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    save();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// --- виртуализация
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

// --- правка
const editing = ref<string | null>(null);
const draft = ref('');
let live = false; // blur после Enter/Esc не сохраняет повторно
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

// --- массовая правка: по одной мутации на задачу
const each = (f: (x: TaskView) => Promise<unknown>) =>
  Promise.all((all.value ?? []).filter((x) => sel.selected.value.has(x.id)).map(f));

// --- поля: правка ячейки и массовая
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
    <div class="flex items-center justify-end border-b border-border px-3 py-1">
      <Popover align="end">
        <template #trigger>
          <Button size="sm">{{ t('table.columns') }}</Button>
        </template>
        <ul class="flex flex-col gap-1 text-sm">
          <li v-for="id in allIds" :key="id">
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                :checked="!hidden.includes(id)"
                :disabled="!hidden.includes(id) && cols.length === 1"
                @change="toggleCol(id, ($event.target as HTMLInputElement).checked)"
              />
              {{ colName(id) }}
            </label>
          </li>
        </ul>
      </Popover>
    </div>

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
          :prevent-on-filter="false"
          @update="
            (e: { oldIndex?: number; newIndex?: number }) => move(e.oldIndex ?? 0, e.newIndex ?? 0)
          "
        >
          <div :style="{ width: `${CHECK_W}px` }" class="no-drag shrink-0" />
          <div
            v-for="(c, i) in cols"
            :key="c.id"
            role="columnheader"
            :data-col="c.id"
            :style="{ width: `${c.width}px` }"
            class="relative flex shrink-0 items-center gap-1 px-2"
          >
            <span class="truncate">{{ colName(c.id) }}</span>
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
            />
          </div>
        </VueDraggable>

        <p v-if="all && !rows.length" class="p-6 text-center text-fg-muted">
          {{ t('table.empty') }}
        </p>
        <div class="relative" :style="{ height: `${virt.getTotalSize()}px` }">
          <div
            v-for="v in virt.getVirtualItems()"
            :key="String(v.key)"
            class="absolute left-0 top-0 w-full"
            :style="{ height: `${v.size}px`, transform: `translateY(${v.start}px)` }"
          >
            <template v-for="task in [rows[v.index]]" :key="task?.id">
              <div
                v-if="task"
                role="row"
                :aria-rowindex="v.index + 2"
                :aria-selected="sel.selected.value.has(task.id)"
                :data-task="task.key"
                :class="[
                  'flex h-full items-center border-b border-border text-sm',
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
                  :style="{ width: `${c.width}px` }"
                  class="min-w-0 shrink-0 truncate px-2"
                  :class="{ 'self-stretch': isFieldCol(c.id) }"
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
                    <span
                      v-else
                      tabindex="0"
                      class="block truncate outline-none focus-visible:ring-2 ring-focus"
                      @dblclick="startEdit(task)"
                      @keydown.enter.prevent="startEdit(task)"
                      >{{ task.title }}</span
                    >
                  </template>
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
                    :space-id="spaceId"
                    :model-value="task.statusId"
                    @update:model-value="updateTask(task.id, { statusId: $event })"
                  />
                  <AssigneePicker
                    v-else-if="c.id === 'assignee'"
                    compact
                    :space-id="spaceId"
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
                    :space-id="spaceId"
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
                        :space-id="spaceId"
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

    <div
      v-if="sel.selected.value.size"
      role="toolbar"
      class="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-3 py-2 text-sm"
    >
      <span>{{ t('table.selected', { n: sel.selected.value.size }) }}</span>
      <StatusPicker
        :space-id="spaceId"
        @update:model-value="each((x) => updateTask(x.id, { statusId: $event }))"
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
