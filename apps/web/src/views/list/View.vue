<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import { ChevronDown, ChevronRight, Plus } from 'lucide-vue-next';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AssigneePicker,
  PriorityPicker,
  StatusPicker,
  createTask,
  deleteTask,
  groupTasks,
  setAssignees,
  sortTasks,
  updateTask,
  useLabels,
  useMembers,
  useProject,
  useProjectTasks,
  useStatuses,
  type TaskGroup,
  type TaskView,
} from '../../tasks';
import { Button, Dialog, Input, useBreakpoint } from '../../ui';
import { openTask, useSelection, type ViewProps } from '..';
import { useTaskFilter } from '../saved/useFilter';
import Row from './Row.vue';

const props = defineProps<ViewProps>();
const { t } = useI18n();
const { isMobile } = useBreakpoint();
const sel = useSelection();

const project = useProject(() => props.projectId);
const spaceId = computed(() => project.value?.spaceId ?? '');
const statuses = useStatuses(spaceId);
const members = useMembers(spaceId);
const labels = useLabels(spaceId);
const all = useProjectTasks(() => props.projectId);
const passes = useTaskFilter(() => props.filter, statuses);

type Item =
  | { id: string; kind: 'group'; group: TaskGroup }
  | { id: string; kind: 'task'; task: TaskView }
  | { id: string; kind: 'create'; group: TaskGroup };

const collapsed = ref(new Set<string>());
const groups = computed(() => {
  const o = props.options;
  const tasks = (all.value ?? []).filter((x) => (o.showSubtasks || !x.parentId) && passes.value(x));
  const ctx = {
    statuses: statuses.value ?? [],
    members: members.value ?? [],
    labels: labels.value ?? [],
  };
  return groupTasks(tasks, o.groupBy, ctx).map((g) => ({
    ...g,
    tasks: sortTasks(g.tasks, o.sortBy, o.sortDir),
  }));
});
const items = computed<Item[]>(() =>
  groups.value.flatMap((g) => [
    { id: `g:${g.key}`, kind: 'group' as const, group: g },
    ...(collapsed.value.has(g.key)
      ? []
      : [
          ...g.tasks.map((task) => ({ id: `t:${g.key}:${task.id}`, kind: 'task' as const, task })),
          { id: `c:${g.key}`, kind: 'create' as const, group: g },
        ]),
  ]),
);
const taskIds = computed(() => [
  ...new Set(items.value.flatMap((i) => (i.kind === 'task' ? [i.task.id] : []))),
]);
const empty = computed(() => !!all.value && !all.value.some((x) => !x.parentId));

// --- виртуализация
const scroller = ref<HTMLElement>();
const rowH = computed(() => (isMobile.value ? 48 : 36));
const virt = useVirtualizer(
  computed(() => ({
    count: items.value.length,
    getScrollElement: () => scroller.value ?? null,
    estimateSize: () => rowH.value,
    overscan: 8,
    getItemKey: (i: number) => items.value[i]?.id ?? i,
  })),
);

// --- фокус и клавиатура
const focusedId = ref<string | null>(null);
const editing = ref<string | null>(null);
const focusedTask = computed(() => {
  const it = items.value.find((i) => i.id === focusedId.value);
  return it?.kind === 'task' ? it.task : undefined;
});

function moveFocus(d: 1 | -1) {
  const list = items.value;
  let i = list.findIndex((x) => x.id === focusedId.value);
  do i += d;
  while (list[i] && list[i].kind !== 'task');
  if (i < 0 && d < 0) i = list.findIndex((x) => x.kind === 'task');
  if (!list[i]) return;
  focusedId.value = list[i].id;
  virt.value.scrollToIndex(i);
}
function onKey(e: KeyboardEvent) {
  // клавиши списка — когда фокус на самом списке или на кнопке/чекбоксе строки (после пикера
  // фокус возвращается на его кнопку); в полях ввода — нет
  const t = e.target as HTMLElement;
  const onRowControl =
    t !== e.currentTarget &&
    !!t.closest('[role=row]') &&
    (t.tagName === 'BUTTON' || (t as HTMLInputElement).type === 'checkbox') &&
    ['j', 'k', 'x'].includes(e.key);
  if ((t !== e.currentTarget && !onRowControl) || e.ctrlKey || e.metaKey || e.altKey) return;
  const task = focusedTask.value;
  const handlers: Record<string, () => void> = {
    j: () => moveFocus(1),
    k: () => moveFocus(-1),
    ArrowDown: () => moveFocus(1),
    ArrowUp: () => moveFocus(-1),
    Enter: () => task && openTask(task.key),
    x: () => task && sel.toggle(task.id),
    F2: () => task && (editing.value = focusedId.value),
    Escape: () => sel.clear(),
  };
  const h = handlers[e.key];
  if (!h) return;
  e.preventDefault();
  h();
}

function onRowClick(it: Extract<Item, { kind: 'task' }>, e: MouseEvent) {
  focusedId.value = it.id;
  if (e.metaKey || e.ctrlKey) sel.toggle(it.task.id);
  else if (e.shiftKey) sel.range(taskIds.value, it.task.id);
  else openTask(it.task.key);
}

// --- быстрое создание
const creating = ref<string | null>(null);
const newTitle = ref('');
const defaultStatus = computed(() => {
  const st = statuses.value ?? [];
  return (st.find((s) => s.category === 'todo') ?? st[0])?.id;
});

async function startCreate(key: string) {
  creating.value = key;
  await nextTick();
  scroller.value?.querySelector<HTMLInputElement>('[data-create] input')?.focus();
}
async function submitCreate(g?: TaskGroup) {
  const title = newTitle.value.trim();
  const by = props.options.groupBy;
  const k = g && g.key !== 'none' ? g.key : undefined;
  const statusId = (by === 'status' && k) || defaultStatus.value;
  if (!title || !statusId) return;
  newTitle.value = '';
  await createTask({
    projectId: props.projectId,
    statusId,
    title,
    ...(by === 'priority' && k && { priority: Number(k) }),
    ...(by === 'assignee' && k && { assigneeIds: [k] }),
    ...(by === 'label' && k && { labelIds: [k] }),
  });
}

// --- массовые действия
const confirmDelete = ref(false);
const chosen = () => (all.value ?? []).filter((x) => sel.selected.value.has(x.id));
const each = (f: (x: TaskView) => Promise<unknown>) => Promise.all(chosen().map(f));
async function removeSelected() {
  confirmDelete.value = false;
  await each((x) => deleteTask(x.id));
  sel.clear();
}

// первая задача в пустом проекте: поле ввода остаётся для следующей
watch(empty, async (e, was) => {
  if (was && !e && creating.value === '') {
    creating.value = groups.value[0]?.key ?? null;
    await nextTick();
    scroller.value?.querySelector<HTMLInputElement>('[data-create] input')?.focus();
  }
});

watch(
  () => props.projectId,
  () => {
    focusedId.value = null;
    collapsed.value = new Set();
  },
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      v-if="empty"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-fg-muted"
    >
      <p>{{ t('list.emptyTitle') }}</p>
      <div v-if="creating === ''" data-create class="w-64">
        <Input
          v-model="newTitle"
          :label="t('list.newTaskTitle')"
          hide-label
          :placeholder="t('list.newTask')"
          @keydown.enter="submitCreate()"
          @keydown.esc="creating = null"
        />
      </div>
      <Button v-else variant="primary" :icon="Plus" @click="startCreate('')">{{
        t('list.create')
      }}</Button>
    </div>
    <div
      v-else
      ref="scroller"
      role="grid"
      tabindex="0"
      :aria-rowcount="items.length"
      class="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 ring-inset ring-focus"
      @keydown="onKey"
    >
      <div class="relative w-full" :style="{ height: `${virt.getTotalSize()}px` }">
        <div
          v-for="v in virt.getVirtualItems()"
          :key="String(v.key)"
          class="absolute left-0 top-0 w-full"
          :style="{ height: `${v.size}px`, transform: `translateY(${v.start}px)` }"
        >
          <template v-for="it in [items[v.index]]" :key="it.id">
            <div
              v-if="it.kind === 'group'"
              role="row"
              :aria-rowindex="v.index + 1"
              class="flex h-full items-center gap-2 border-b border-border bg-bg-muted px-3 text-sm font-medium"
            >
              <button
                type="button"
                :aria-expanded="!collapsed.has(it.group.key)"
                :aria-label="t(collapsed.has(it.group.key) ? 'list.expand' : 'list.collapse')"
                class="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-bg-subtle focus-visible:ring-2 ring-focus"
                @click="
                  collapsed.has(it.group.key)
                    ? collapsed.delete(it.group.key)
                    : collapsed.add(it.group.key);
                  collapsed = new Set(collapsed);
                "
              >
                <component
                  :is="collapsed.has(it.group.key) ? ChevronRight : ChevronDown"
                  :size="16"
                  aria-hidden="true"
                />
              </button>
              <span
                v-if="it.group.color"
                class="size-2.5 rounded-full"
                :style="{ background: it.group.color }"
                aria-hidden="true"
              />
              <span class="truncate">{{ it.group.label }}</span>
              <span class="text-fg-subtle">{{ it.group.tasks.length }}</span>
            </div>
            <Row
              v-else-if="it.kind === 'task'"
              :task="it.task"
              :space-id="spaceId"
              :index="v.index + 1"
              :selected="sel.selected.value.has(it.task.id)"
              :focused="focusedId === it.id"
              :editing="editing === it.id"
              :fields="options.fields"
              @click="onRowClick(it, $event)"
              @toggle="sel.toggle(it.task.id)"
              @edit="editing = it.id"
              @done="
                editing = null;
                scroller?.focus();
              "
            />
            <div
              v-else
              role="row"
              :aria-rowindex="v.index + 1"
              data-create
              class="flex h-full items-center border-b border-border px-3 pl-10"
            >
              <input
                v-if="creating === it.group.key"
                v-model="newTitle"
                :aria-label="t('list.newTaskTitle')"
                :placeholder="t('list.newTask')"
                class="h-7 w-full rounded-md border border-border-strong bg-bg px-2 text-sm outline-none focus-visible:ring-2 ring-focus"
                @keydown.enter.prevent="submitCreate(it.group)"
                @keydown.esc.prevent="creating = null"
                @blur="!newTitle && (creating = null)"
              />
              <button
                v-else
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm text-fg-muted outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
                @click="startCreate(it.group.key)"
              >
                <Plus :size="14" aria-hidden="true" />{{ t('list.newTask') }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div
      v-if="sel.selected.value.size"
      role="toolbar"
      class="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-3 py-2 text-sm"
    >
      <span>{{ t('list.selected', { n: sel.selected.value.size }) }}</span>
      <StatusPicker
        :space-id="spaceId"
        @update:model-value="each((x) => updateTask(x.id, { statusId: $event }))"
      />
      <AssigneePicker
        :space-id="spaceId"
        @update:model-value="
          each((x) => setAssignees(x.id, [...new Set([...x.assigneeIds, ...$event])]))
        "
      />
      <PriorityPicker @update:model-value="each((x) => updateTask(x.id, { priority: $event }))" />
      <Button variant="danger" size="sm" @click="confirmDelete = true">{{
        t('list.delete')
      }}</Button>
    </div>

    <Dialog
      v-model:open="confirmDelete"
      :title="t('list.deleteTitle')"
      :description="t('list.deleteText', { n: sel.selected.value.size })"
    >
      <template #footer>
        <Button @click="confirmDelete = false">{{ t('list.cancel') }}</Button>
        <Button variant="danger" data-testid="confirm-delete" @click="removeSelected">{{
          t('list.delete')
        }}</Button>
      </template>
    </Dialog>
  </div>
</template>
