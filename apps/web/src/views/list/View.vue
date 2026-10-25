<script setup lang="ts">
import TaskContextMenu from '../TaskContextMenu.vue';
import BulkBar from '../BulkBar.vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { ChevronDown, ChevronRight, ListChecks, Plus } from 'lucide-vue-next';
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
  useScopeTasks,
  useStatuses,
  type TaskGroup,
  type TaskView,
} from '../../tasks';
import { Button, Dialog, EmptyState, Input, Menu, useBreakpoint, type MenuItem } from '../../ui';
import { router } from '../../router';
import { useExtensions } from '../../modules/registry';
import { openTask, useSelection, type ViewProps } from '..';
import { useTaskFilter } from '../saved/useFilter';
import { useBlockedIds } from '../../links';
import { useProjectNames, useStatusKey } from '../scope';
import Row from './Row.vue';
import { treeOrder } from './tree';
import { COLUMN_CLASS, visibleColumns } from './columns';
import { useColumnWidths } from './widths';
import { applyMove, planMove } from '../board/plan';

const props = defineProps<ViewProps>();
const { t, locale } = useI18n();
const { isMobile } = useBreakpoint();
const sel = useSelection();

const project = useProject(() => props.projectId);
const blocked = useBlockedIds(() => props.projectId);
const spaceId = computed(() => props.scope?.spaceIds.join(',') ?? project.value?.spaceId ?? '');
const statuses = useStatuses(spaceId);
const members = useMembers(spaceId);
const labels = useLabels(spaceId);
const all = useScopeTasks(() => props.scope?.projectIds ?? [props.projectId]);
const statusKey = useStatusKey(() => props.scope, statuses);
const projectNames = useProjectNames();
// колонки: авторазмер по содержимому, разделитель в шапке — вручную (двойной клик — снова авто)
const {
  widths,
  startResize,
  reset: resetWidth,
} = useColumnWidths(
  () => props.projectId,
  () => visibleColumns(props.options.fields),
  all,
  () => ({
    users: new Map((members.value ?? []).map((u) => [u.id, u.name])),
    labels: new Map((labels.value ?? []).map((l) => [l.id, l.name])),
    projects: projectNames.value,
    header: (c) => colName(c),
    noAssignee: t('tasks.noAssignee'),
    priority: (p) => t(`tasks.priority.${p}`),
    locale: locale.value,
  }),
);
const passes = useTaskFilter(
  () => props.filter,
  statuses,
  () => props.options.me,
);

type Item =
  | { id: string; kind: 'head' }
  | { id: string; kind: 'group'; group: TaskGroup }
  | {
      id: string;
      kind: 'task';
      task: TaskView;
      group: string;
      depth: number;
      parentTitle?: string;
      childCount: number;
    }
  | { id: string; kind: 'create'; group: TaskGroup };

const collapsed = ref(new Set<string>());
const groups = computed(() => {
  const o = props.options;
  const tasks = (all.value ?? []).filter((x) => (o.showSubtasks || !x.parentId) && passes.value(x));
  const ctx = {
    statuses: statuses.value ?? [],
    members: members.value ?? [],
    labels: labels.value ?? [],
    statusKey: statusKey.value,
  };
  return groupTasks(tasks, o.groupBy, ctx).map((g) => ({
    ...g,
    tasks: sortTasks(g.tasks, o.sortBy, o.sortDir),
  }));
});

// свёрнутые подзадачи: id родителей, на проект — в localStorage
const foldKey = () => `planar.list.${props.projectId}.folded`;
const folded = ref(new Set<string>());
watch(
  () => props.projectId,
  () => {
    try {
      folded.value = new Set(JSON.parse(localStorage.getItem(foldKey()) ?? '[]'));
    } catch {
      folded.value = new Set();
    }
  },
  { immediate: true },
);
function toggleFold(id: string) {
  const f = new Set(folded.value);
  if (!f.delete(id)) f.add(id);
  folded.value = f;
  try {
    localStorage.setItem(foldKey(), JSON.stringify([...f]));
  } catch {
    /* без хранилища — до перезагрузки */
  }
}

// подзадачи — деревом под родителем; родитель не над строкой — подпись в строке
const byId = computed(() => new Map((all.value ?? []).map((x) => [x.id, x])));
const items = computed<Item[]>(() => {
  const head: Item[] = props.options.groupBy === 'none' ? [{ id: 'head', kind: 'head' }] : [];
  return head.concat(
    groups.value.flatMap((g): Item[] => {
      if (collapsed.value.has(g.key)) return [{ id: `g:${g.key}`, kind: 'group', group: g }];
      const tree = treeOrder(g.tasks);
      const kids = new Map<string, number>();
      for (const x of tree)
        if (x.depth) kids.set(x.task.parentId!, (kids.get(x.task.parentId!) ?? 0) + 1);
      const rows: Item[] = [];
      let hideBelow = Infinity; // глубина свёрнутого предка: строки глубже — скрыты
      for (const { task, depth } of tree) {
        if (depth > hideBelow) continue;
        hideBelow = folded.value.has(task.id) && kids.has(task.id) ? depth : Infinity;
        rows.push({
          id: `t:${g.key}:${task.id}`,
          kind: 'task',
          task,
          group: g.key,
          depth,
          parentTitle: !depth && task.parentId ? byId.value.get(task.parentId)?.title : undefined,
          childCount: kids.get(task.id) ?? 0,
        });
      }
      return [
        ...(props.options.groupBy === 'none'
          ? []
          : [{ id: `g:${g.key}`, kind: 'group' as const, group: g }]),
        ...rows,
        ...(props.scope ? [] : [{ id: `c:${g.key}`, kind: 'create' as const, group: g }]),
      ];
    }),
  );
});
const columns = computed(() => visibleColumns(props.options.fields));
const COL_LABEL = {
  assignee: 'tasks.assignee',
  dueDate: 'tasks.dueDate',
  priority: 'tasks.priorityTitle',
  labels: 'tasks.labels',
  project: 'views.fields.project',
} as const;
const colName = (c: keyof typeof COL_LABEL) => t(COL_LABEL[c]);

// --- перетаскивание (сортировка «Вручную»):
// середина строки — сделать подзадачей этой задачи; граница — встать на уровень следующей строки
const manual = computed(
  () => !props.scope && props.options.sortBy === 'rank' && props.options.sortDir === 'asc',
);
type Drop = { mode: 'slot'; slot: number } | { mode: 'nest'; index: number };
const drag = ref<{ task: TaskView; from: string; drop: Drop } | null>(null);
// потомки перетаскиваемой задачи: в них её не вложить
const descendants = (id: string) => {
  const out = new Set<string>([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const x of all.value ?? [])
      if (x.parentId && out.has(x.parentId) && !out.has(x.id)) (out.add(x.id), (grew = true));
  }
  return out;
};
let banned = new Set<string>();
function dropAt(clientY: number): Drop {
  const el = scroller.value!;
  const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
  const i = Math.floor(y / rowH.value);
  const frac = y / rowH.value - i;
  const it = items.value[i];
  if (it?.kind === 'task' && !banned.has(it.task.id) && frac > 0.3 && frac < 0.7)
    return { mode: 'nest', index: i };
  return {
    mode: 'slot',
    slot: Math.max(0, Math.min(items.value.length, Math.round(y / rowH.value))),
  };
}
// уровень линии-индикатора — по следующей строке
const dropDepth = computed(() => {
  const d = drag.value?.drop;
  const next = d?.mode === 'slot' ? items.value[d.slot] : undefined;
  return next?.kind === 'task' ? next.depth : 0;
});
const nestId = computed(() => {
  const d = drag.value?.drop;
  return d?.mode === 'nest' ? items.value[d.index]?.id : undefined;
});
function onDragMove(e: PointerEvent) {
  if (!drag.value) return;
  const el = scroller.value!;
  const r = el.getBoundingClientRect();
  if (e.clientY < r.top + 32)
    el.scrollTop -= 12; // автопрокрутка у краёв
  else if (e.clientY > r.bottom - 32) el.scrollTop += 12;
  drag.value.drop = dropAt(e.clientY);
}
const groupOf = (it: Item | undefined) =>
  !it || it.kind === 'head' ? undefined : it.kind === 'task' ? it.group : it.group.key;
async function onDragEnd() {
  removeEventListener('pointermove', onDragMove);
  const d = drag.value;
  drag.value = null;
  if (!d) return;
  const list = items.value;
  let to: string | undefined;
  let parent: string | null;
  let beforeId: string | null = null;
  if (d.drop.mode === 'nest') {
    const target = list[d.drop.index] as Extract<Item, { kind: 'task' }>;
    to = target.group;
    parent = target.task.id; // в конец подзадач цели
  } else {
    const prev = list[d.drop.slot - 1];
    const next = list[d.drop.slot];
    to = groupOf(prev) ?? groups.value[0]?.key;
    const nextTask = next?.kind === 'task' && next.group === to ? next : undefined;
    if (nextTask && banned.has(nextTask.task.id) && nextTask.task.id !== d.task.id) return; // внутрь себя
    parent = nextTask ? nextTask.task.parentId : null;
    if (nextTask && nextTask.task.id !== d.task.id) beforeId = nextTask.task.id;
    else if (nextTask) {
      // бросили прямо перед собой — следующий брат после себя
      const after = list
        .slice(d.drop.slot + 1)
        .find((x) => x.kind === 'task' && x.group === to && x.task.parentId === parent);
      beforeId = after?.kind === 'task' ? after.task.id : null;
    }
  }
  if (!to) return;
  const reparent = parent !== d.task.parentId;
  const sibs = (g: TaskGroup) => g.tasks.filter((x) => x.parentId === parent && x.id !== d.task.id);
  // ранг — среди новых братьев; поле группы меняет planMove при переносе в другую группу
  const cols = groups.value.map((g) => ({
    ...g,
    tasks: [...sibs(g), ...(g.key === d.from ? [d.task] : [])].sort((a, b) =>
      a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0,
    ),
  }));
  let plan = planMove(cols, props.options.groupBy, d.task.id, d.from, to, beforeId);
  if (!plan && reparent) {
    const target = cols.find((c) => c.key === to)!.tasks.filter((x) => x.id !== d.task.id);
    const i = beforeId ? target.findIndex((x) => x.id === beforeId) : target.length;
    plan = { id: d.task.id, after: target[i - 1]?.rank ?? null, before: target[i]?.rank ?? null };
  }
  if (reparent) await updateTask(d.task.id, { parentId: parent });
  if (plan) await applyMove(plan);
}
function startDrag(it: { task: TaskView; group: string }, e: PointerEvent) {
  banned = descendants(it.task.id);
  drag.value = { task: it.task, from: it.group, drop: dropAt(e.clientY) };
  addEventListener('pointermove', onDragMove);
  addEventListener('pointerup', () => void onDragEnd(), { once: true });
}
const taskIds = computed(() => [
  ...new Set(items.value.flatMap((i) => (i.kind === 'task' ? [i.task.id] : []))),
]);
const empty = computed(() => !!all.value && !all.value.some((x) => !x.parentId));

// --- виртуализация
const scroller = ref<HTMLElement>();
const rowH = computed(() => (isMobile.value ? 48 : 32));
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
    F2: () => task && startEdit(focusedId.value!), // правка, а не открытие после клика
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
  else {
    // двойной клик по названию = правка: открытие откладываем, dblclick его отменяет
    clearTimeout(openTimer);
    openTimer = setTimeout(() => openTask(it.task.key), 250);
  }
}
function startEdit(id: string) {
  clearTimeout(openTimer);
  editing.value = id;
}
let openTimer: ReturnType<typeof setTimeout> | undefined;

// --- меню «Новая задача»: команды модулей с newTaskMenu
const cmds = useExtensions('commands');
const newMenu = computed<MenuItem[]>(() => {
  const ctx = {
    route: router.currentRoute.value,
    selectedTaskIds: [...sel.selected.value],
    projectId: props.projectId,
  };
  return cmds.value
    .filter((c) => c.newTaskMenu && (!c.when || c.when(ctx)))
    .map((c) => ({
      id: c.key,
      label: typeof c.label === 'string' ? t(c.label) : c.label[locale.value as 'ru' | 'en'],
      icon: c.icon,
      onSelect: () => void c.run(ctx),
    }));
});

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
    <EmptyState
      v-if="empty"
      class="flex-1 justify-center !pt-8"
      :icon="ListChecks"
      :title="t('list.emptyTitle')"
      :description="t('list.emptyHint')"
    >
      <template #actions>
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
        <template v-else>
          <Button v-if="!scope" variant="primary" :icon="Plus" @click="startCreate('')">{{
            t('list.create')
          }}</Button>
          <Menu v-if="newMenu.length && !scope" :items="newMenu" :label="t('list.newMenu')" />
        </template>
      </template>
    </EmptyState>
    <TaskContextMenu v-else :space-id="spaceId" :tasks="all">
      <div
        ref="scroller"
        role="grid"
        tabindex="0"
        :aria-rowcount="items.length"
        class="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 ring-inset ring-focus"
        @keydown="onKey"
      >
        <div class="relative w-full" :style="{ height: `${virt.getTotalSize()}px` }">
          <div
            v-if="drag?.drop.mode === 'slot'"
            class="pointer-events-none absolute right-0 z-10 h-0.5 bg-accent"
            :style="{ top: `${drag.drop.slot * rowH - 1}px`, left: `${40 + dropDepth * 20}px` }"
            data-testid="drop-line"
          />
          <div
            v-for="v in virt.getVirtualItems()"
            :key="String(v.key)"
            class="absolute left-0 top-0 w-full"
            :style="{ height: `${v.size}px`, transform: `translateY(${v.start}px)` }"
          >
            <template v-for="it in [items[v.index]]" :key="it.id">
              <div
                v-if="it.kind === 'head'"
                role="row"
                class="flex h-full items-center border-b border-border px-3 pl-10 text-xs text-fg-muted"
              >
                <span class="flex-1">{{ t('list.colName') }}</span>
                <span
                  v-for="c in columns"
                  :key="c"
                  :class="['relative shrink-0 truncate px-1', COLUMN_CLASS[c]]"
                  :style="{ width: `${widths[c]}px` }"
                  >{{ colName(c)
                  }}<span
                    role="separator"
                    aria-orientation="vertical"
                    :aria-label="t('list.resize')"
                    data-testid="col-resize"
                    class="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-accent"
                    @pointerdown.stop.prevent="startResize(c, $event)"
                    @dblclick.stop="resetWidth(c)"
                /></span>
              </div>
              <div
                v-else-if="it.kind === 'group'"
                role="row"
                :aria-rowindex="v.index + 1"
                class="flex h-full items-center gap-2 border-b border-border px-3 text-sm"
                data-testid="group-row"
              >
                <button
                  type="button"
                  :aria-expanded="!collapsed.has(it.group.key)"
                  :aria-label="t(collapsed.has(it.group.key) ? 'list.expand' : 'list.collapse')"
                  class="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
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
                <!-- плашка группы цветом статуса/метки, как в ClickUp -->
                <span
                  class="truncate rounded px-2 py-0.5 text-xs font-semibold uppercase"
                  :class="it.group.color ? 'text-white' : 'bg-bg-muted text-fg'"
                  :style="it.group.color && { background: it.group.color }"
                  >{{ it.group.label }}</span
                >
                <span class="text-xs text-fg-subtle">{{ it.group.tasks.length }}</span>
                <span class="ml-auto flex shrink-0 text-xs text-fg-muted max-md:hidden">
                  <span
                    v-for="c in columns"
                    :key="c"
                    :class="['relative shrink-0 truncate px-1', COLUMN_CLASS[c]]"
                    :style="{ width: `${widths[c]}px` }"
                    >{{ colName(c)
                    }}<span
                      role="separator"
                      aria-orientation="vertical"
                      :aria-label="t('list.resize')"
                      data-testid="col-resize"
                      class="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-accent"
                      @pointerdown.stop.prevent="startResize(c, $event)"
                      @dblclick.stop="resetWidth(c)"
                  /></span>
                </span>
              </div>
              <Row
                v-else-if="it.kind === 'task'"
                :task="it.task"
                :space-id="it.task.spaceId"
                :project-name="projectNames.get(it.task.projectId)"
                :widths="widths"
                :index="v.index + 1"
                :selected="sel.selected.value.has(it.task.id)"
                :focused="focusedId === it.id"
                :editing="editing === it.id"
                :fields="options.fields"
                :blocked="blocked.has(it.task.id)"
                :members="members ?? []"
                :labels="labels ?? []"
                :depth="it.depth"
                :parent-title="it.parentTitle"
                :draggable="manual"
                :child-count="it.childCount"
                :folded="folded.has(it.task.id)"
                :class="[
                  drag?.task.id === it.task.id && 'opacity-40',
                  nestId === it.id && 'ring-2 ring-inset ring-accent',
                ]"
                @fold="toggleFold(it.task.id)"
                @drag="startDrag(it, $event)"
                @click="onRowClick(it, $event)"
                @toggle="sel.toggle(it.task.id)"
                @edit="startEdit(it.id)"
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
                <Menu v-if="newMenu.length" :items="newMenu" :label="t('list.newMenu')" />
              </div>
            </template>
          </div>
        </div>
      </div>
    </TaskContextMenu>

    <BulkBar :space-id="spaceId" :tasks="all" />
  </div>
</template>
