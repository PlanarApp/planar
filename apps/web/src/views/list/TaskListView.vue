<script setup lang="ts">
import TaskContextMenu from '../TaskContextMenu.vue';
import BulkBar from '../BulkBar.vue';
import { useVirtualizer, type VirtualItem } from '@tanstack/vue-virtual';
import { ChevronDown, ChevronRight, ListChecks, Plus } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AssigneePicker,
  PriorityPicker,
  StatusPicker,
  createTask,
  deleteTask,
  setAssignees,
  updateTask,
  useLabels,
  useMembers,
  useProject,
  useStatuses,
  type TaskGroup,
  type TaskView,
} from '../../tasks';
import { Button, Dialog, EmptyState, Input, Menu, useBreakpoint, type MenuItem } from '../../ui';
import { router } from '../../router';
import { useExtensions } from '../../modules/registry';
import { openTask, useSelection, type Selection, type ViewProps } from '..';
import { openTaskFor, showTask, sideTaskOpen } from '../open';
import { useTaskFilter } from '../saved/useFilter';
import { useBlockedIds } from '../../links';
import { toggleToday } from '../../inbox/myDay';
import {
  createStatus,
  dictProjectOf,
  fixPlan,
  labelFor,
  statusFor,
  useLabelKey,
  useProjectNames,
  useStatusKey,
  useWidenedFilter,
} from '../scope';
import Row from './Row.vue';
import { useSelectionReset } from '../selection';
import { treeOrder } from './tree';
import { useColumnWidths } from './widths';
import { useViewSettings, type ViewSettingsSource } from './viewSettings';
import type { TaskListSource } from './source';
import { applyMove, planMove } from '../board/plan';
import { tokenOf } from '../../command/hotkeys';
import { endTaskDrag, overProject, projectAt, startTaskDrag } from '../../tasks/dropToProject';
import { dragSet, dropAnchor, groupRanks, moveGroupApi, moveGroupLocal } from '../groupMove';
import { toast } from '../../ui/toast';

/**
 * PLNRAPP-863: the task list — rows with inline editing, context menu, multiple selection, dragging,
 * the "View" settings applied. Data and settings come in as parameters: the project List passes its
 * tasks and view options, another screen — its own.
 */
const props = withDefaults(
  defineProps<{
    source: TaskListSource;
    settings: ViewSettingsSource;
    /** the project: dictionaries, task creation, storage of folding and column widths */
    projectId: string;
    filter?: ViewProps['filter'];
    scope?: ViewProps['scope'];
    /** dragging in the "Manual" sort; false — off */
    dnd?: boolean;
    /** the selection context; none — the injected one (provideSelection) */
    selection?: Selection;
    /**
     * PLNRAPP-865: the list shows the subtasks of this task (the "Subtasks" tab of the card) — they are
     * the top-level rows, a task is not nested into another by dragging (it would leave the list)
     */
    rootId?: string;
    /** opening a task (click, Enter); none — openTask */
    open?: (key: string) => void;
    /** the "New task" rows of the groups and the empty state's button; false — the screen has its own */
    quickCreate?: boolean;
    /** list keys (j/k, arrows) when the focus is outside the list (on the page); false — only in the list */
    windowKeys?: boolean;
    /**
     * PLNRAPP-868: the screen's own groups instead of the "View" grouping and sorting (the blocks of «My day»);
     * dragging between them is off
     */
    groups?: (tasks: TaskView[]) => TaskGroup[];
  }>(),
  { dnd: true, quickCreate: true, windowKeys: true },
);
const openKey = (key: string) => (props.open ?? openTask)(key);
const { t, locale } = useI18n();
const { isMobile } = useBreakpoint();
// mobile: the list is drawn as task cards, without the column header
const asCards = computed(() => isMobile.value);
const sel = props.selection ?? useSelection();

const project = useProject(() => props.projectId);
const blocked = useBlockedIds(() => props.projectId);
const spaceId = computed(() => props.scope?.spaceIds.join(',') ?? project.value?.spaceId ?? '');
// a project view reads its own dictionaries; a summary — those of all its projects (grouped by name)
const dictProject = () => dictProjectOf(props.scope, props.projectId);
const statuses = useStatuses(spaceId, dictProject);
const members = useMembers(spaceId);
const labels = useLabels(spaceId, dictProject);
const all = computed(() => props.source.tasks);
const statusKey = useStatusKey(() => props.scope, statuses);
const labelKey = useLabelKey(() => props.scope, labels);
// the "View" settings: fields, grouping, sorting, density
const {
  options,
  fields: listFields,
  columns,
  groups,
  grouped,
  density,
  manual: manualSort,
} = useViewSettings(() => props.settings, all, {
  projectIds: () => props.scope?.projectIds ?? [props.projectId],
  passes: () => passes.value,
  groups: () => props.groups,
  group: () => ({
    statuses: statuses.value ?? [],
    members: members.value ?? [],
    labels: labels.value ?? [],
    statusKey: statusKey.value,
    labelKey: labelKey.value,
  }),
});
const projectNames = useProjectNames();
// columns: auto-size by content
const { widths } = useColumnWidths(columns, all, () => ({
  labels: new Map((labels.value ?? []).map((l) => [l.id, l.name])),
  labelNames: density.value.showLabelNames,
  projects: projectNames.value,
  priority: (p) => t(`tasks.priority.${p}`),
  locale: locale.value,
}));
const passes = useTaskFilter(
  useWidenedFilter(() => props.filter),
  statuses,
  () => options.value.me,
  () => (props.scope ? undefined : props.projectId),
);

type Item =
  | { id: string; kind: 'group'; group: TaskGroup }
  | {
      id: string;
      kind: 'task';
      task: TaskView;
      group: string;
      depth: number;
      parent?: TaskView;
      /** undefined — the group has no subtasks: no room reserved for the fold chevron */
      childCount?: number;
    }
  | { id: string; kind: 'create'; group: TaskGroup };

const collapsed = ref(new Set<string>());

// collapsed subtasks: parent ids, per project — in localStorage
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
// folded — exceptions to the view's mode "Collapsed / Expanded" (PLNRAPP-162)
const isFolded = (id: string) => !!options.value.subtasksCollapsed !== folded.value.has(id);
function saveFolded(f: Set<string>) {
  folded.value = f;
  try {
    localStorage.setItem(foldKey(), JSON.stringify([...f]));
  } catch {
    /* without storage — until reload */
  }
}
function toggleFold(id: string) {
  const f = new Set(folded.value);
  if (!f.delete(id)) f.add(id);
  saveFolded(f);
}
// a new mode applies to all parents
watch(
  () => !!options.value.subtasksCollapsed,
  () => saveFolded(new Set()),
);

// subtasks — as a tree under the parent; a parent not above the row — a label in the row
const byId = computed(() => new Map((all.value ?? []).map((x) => [x.id, x])));
const items = computed<Item[]>(() => {
  // no column header row: the fields are named by their values, sorting is in the "View" menu
  return groups.value.flatMap((g): Item[] => {
    if (collapsed.value.has(g.key)) return [{ id: `g:${g.key}`, kind: 'group', group: g }];
    const tree = treeOrder(g.tasks);
    const kids = new Map<string, number>();
    for (const x of tree)
      if (x.depth) kids.set(x.task.parentId!, (kids.get(x.task.parentId!) ?? 0) + 1);
    const rows: Item[] = [];
    let hideBelow = Infinity; // depth of the collapsed ancestor: rows deeper than it are hidden
    for (const { task, depth } of tree) {
      if (depth > hideBelow) continue;
      hideBelow = isFolded(task.id) && kids.has(task.id) ? depth : Infinity;
      rows.push({
        id: `t:${g.key}:${task.id}`,
        kind: 'task',
        task,
        group: g.key,
        depth,
        parent: !depth && task.parentId ? byId.value.get(task.parentId) : undefined,
        childCount: kids.size ? (kids.get(task.id) ?? 0) : undefined,
      });
    }
    return [
      ...(!grouped.value ? [] : [{ id: `g:${g.key}`, kind: 'group' as const, group: g }]),
      ...rows,
      ...((props.scope && !props.scope.createIn) || !props.quickCreate
        ? []
        : [{ id: `c:${g.key}`, kind: 'create' as const, group: g }]),
    ];
  });
});

// --- dragging ("Manual" sort):
// middle of a row — make it a subtask of this task; edge — place at the level of the next row
const manual = computed(() => props.dnd && manualSort.value);
type Drop = { mode: 'slot'; slot: number } | { mode: 'nest'; index: number };
// ids — the moved tasks (PLNRAPP-294: all the selected ones when a selected task is dragged), x/y — the pointer
const drag = ref<{
  task: TaskView;
  from: string;
  drop: Drop;
  ids: string[];
  x: number;
  y: number;
} | null>(null);
const dragIds = computed(() => new Set(drag.value?.ids));
// descendants of the dragged task: it can't be nested into them
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
let dragProject = '';
function dropAt(clientY: number): Drop {
  const el = scroller.value!;
  const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
  // by the measured rows: wrapped names make them of different heights (PLANARAPP-62)
  const v = virt.value.getVirtualItemForOffset(y);
  if (!v) return { mode: 'slot', slot: 0 };
  const i = v.index;
  const frac = (y - v.start) / v.size;
  const it = items.value[i];
  // inside — only tasks of the same project (the group summary mixes projects)
  if (
    it?.kind === 'task' &&
    (drag.value?.ids.length ?? 1) < 2 && // a group is not nested into a task
    !props.rootId &&
    !banned.has(it.task.id) &&
    it.task.projectId === dragProject &&
    frac > 0.3 &&
    frac < 0.7
  )
    return { mode: 'nest', index: i };
  return {
    mode: 'slot',
    slot: Math.max(0, Math.min(items.value.length, frac < 0.5 ? i : i + 1)),
  };
}
const slotTop = (slot: number) =>
  virt.value.measurementsCache[slot]?.start ?? virt.value.getTotalSize();
// the level of the indicator line — by the next row
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
    el.scrollTop -= 12; // auto-scroll near the edges
  else if (e.clientY > r.bottom - 32) el.scrollTop += 12;
  drag.value.drop = dropAt(e.clientY);
  drag.value.x = e.clientX;
  drag.value.y = e.clientY;
  if (drag.value.ids.length < 2) overProject.value = projectAt(e.clientX, e.clientY);
}
const groupOf = (it: Item | undefined) =>
  !it ? undefined : it.kind === 'task' ? it.group : it.group.key;
async function onDragEnd() {
  removeEventListener('pointermove', onDragMove);
  const d = drag.value;
  drag.value = null;
  if (!d || endTaskDrag()) return;
  if (d.ids.length > 1) return dropGroup(d);
  const list = items.value;
  let to: string | undefined;
  let parent: string | null;
  let beforeId: string | null = null;
  if (d.drop.mode === 'nest') {
    const target = list[d.drop.index] as Extract<Item, { kind: 'task' }>;
    to = target.group;
    parent = target.task.id; // to the end of the target's subtasks
  } else {
    const prev = list[d.drop.slot - 1];
    const next = list[d.drop.slot];
    to = groupOf(prev) ?? groups.value[0]?.key;
    const nextTask = next?.kind === 'task' && next.group === to ? next : undefined;
    if (nextTask && banned.has(nextTask.task.id) && nextTask.task.id !== d.task.id) return; // into itself
    parent = nextTask ? nextTask.task.parentId : null;
    // parent from another project (summary) — the parent is not changed
    if (parent && byId.value.get(parent)?.projectId !== d.task.projectId) parent = d.task.parentId;
    if (nextTask && nextTask.task.id !== d.task.id) beforeId = nextTask.task.id;
    else if (nextTask) {
      // dropped right in front of itself — the next sibling after itself
      const after = list
        .slice(d.drop.slot + 1)
        .find((x) => x.kind === 'task' && x.group === to && x.task.parentId === parent);
      beforeId = after?.kind === 'task' ? after.task.id : null;
    }
  }
  if (!to) return;
  const reparent = parent !== d.task.parentId;
  const sibs = (g: TaskGroup) => g.tasks.filter((x) => x.parentId === parent && x.id !== d.task.id);
  // rank — among the new siblings; the group field is changed by planMove when moving to another group
  const cols = groups.value.map((g) => ({
    ...g,
    tasks: [...sibs(g), ...(g.key === d.from ? [d.task] : [])].sort((a, b) =>
      a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0,
    ),
  }));
  let plan = fixPlan(
    planMove(cols, options.value.groupBy, d.task.id, d.from, to, beforeId, labelKey.value),
    d.task,
    !!statusKey.value,
    statuses.value ?? [],
    labels.value ?? [],
  );
  if (!plan && d.from !== to && statusKey.value) return; // the task's space has no such status
  if (!plan && reparent) {
    const target = cols.find((c) => c.key === to)!.tasks.filter((x) => x.id !== d.task.id);
    const i = beforeId ? target.findIndex((x) => x.id === beforeId) : target.length;
    plan = { id: d.task.id, after: target[i - 1]?.rank ?? null, before: target[i]?.rank ?? null };
  }
  if (reparent) await updateTask(d.task.id, { parentId: parent });
  if (plan) await applyMove(plan);
}
/**
 * PLNRAPP-294: the group goes in a row to the drop point, in the view's order. Status grouping — the
 * atomic group move of the API (one project); other groupings — the group field and ranks locally.
 */
async function dropGroup(d: NonNullable<typeof drag.value>) {
  if (d.drop.mode !== 'slot') return;
  const list = items.value;
  const moved = new Set(d.ids);
  const to = groupOf(list[d.drop.slot - 1]) ?? groups.value[0]?.key;
  if (!to) return;
  const beforeId = dropAnchor(list.slice(d.drop.slot), to, moved);
  const tasks = d.ids.flatMap((id) => byId.value.get(id) ?? []);
  const by = options.value.groupBy;
  if (by === 'status') {
    const p = d.task.projectId;
    if (tasks.some((x) => x.projectId !== p)) return toast(t('list.groupMoveProjects'));
    const statusId = statusKey.value ? statusFor(statuses.value ?? [], d.task.spaceId, to, p) : to;
    if (statusId) await moveGroupApi(d.ids, statusId, beforeId, (x) => byId.value.get(x)?.key ?? x);
    return;
  }
  const column = (groups.value.find((g) => g.key === to)?.tasks ?? [])
    .filter((x) => !moved.has(x.id))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const { ranks, rerank } = groupRanks(column, beforeId, tasks.length);
  await moveGroupLocal({
    tasks,
    by,
    from: (id) =>
      id === d.task.id ? d.from : groups.value.find((g) => g.tasks.some((x) => x.id === id))?.key,
    to,
    ranks,
    rerank,
    labelKey: labelKey.value,
    fixLabels: (x, ls) =>
      fixPlan(
        { labels: ls },
        byId.value.get(x.id),
        !!statusKey.value,
        statuses.value ?? [],
        labels.value ?? [],
      )?.labels ?? ls,
  });
}
function startDrag(it: { task: TaskView; group: string }, e: PointerEvent) {
  banned = descendants(it.task.id);
  dragProject = it.task.projectId;
  // a selected task — with all the selected; an unselected one — alone, the selection is reset
  const order = [
    ...items.value.flatMap((x) => (x.kind === 'task' ? [x.task.id] : [])),
    ...groups.value.flatMap((g) => g.tasks.map((x) => x.id)),
  ];
  const ids = dragSet(sel.selected.value, it.task.id, order);
  if (!sel.selected.value.has(it.task.id) && sel.active.value) sel.clear();
  drag.value = {
    task: it.task,
    from: it.group,
    drop: { mode: 'slot', slot: 0 },
    ids,
    x: e.clientX,
    y: e.clientY,
  };
  drag.value.drop = dropAt(e.clientY);
  if (ids.length < 2) startTaskDrag(it.task);
  addEventListener('pointermove', onDragMove);
  addEventListener('pointerup', () => void onDragEnd(), { once: true });
}
const taskIds = computed(() => [
  ...new Set(items.value.flatMap((i) => (i.kind === 'task' ? [i.task.id] : []))),
]);
// "select all": every task of every group, including collapsed ones
const allIds = computed(() => [...new Set(groups.value.flatMap((g) => g.tasks.map((x) => x.id)))]);
const empty = computed(
  () =>
    !!all.value &&
    !all.value.some((x) => !x.parentId || (!!props.rootId && x.parentId === props.rootId)),
);

// --- virtualization
const scroller = ref<HTMLElement>();
// Escape / a click on an empty place of the list — out of the selection mode (PLNRAPP-291)
useSelectionReset(() => scroller.value);
const rowH = computed(() => (isMobile.value ? 44 : 32));
// PLNRAPP-817: two layouts — the wide row with the columns and the card (mobile, or the list area under
// half of the window: the task sidebar is open, a small window); the card is measured by the virtualizer
const areaW = ref(0);
const half = ref(0);
let ro: ResizeObserver | undefined;
const fit = () => {
  const el = scroller.value;
  if (!el) return;
  areaW.value = el.clientWidth;
  half.value = window.innerWidth / 2;
};
const narrow = computed(() => areaW.value > 0 && areaW.value < half.value);
watch(scroller, (el) => {
  ro?.disconnect();
  if (el && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(fit);
    ro.observe(el);
  }
  fit();
});
onBeforeUnmount(() => ro?.disconnect());
// the screen's own groups (blocks of «My day») are sections, not an accordion: a gap above each but the first
const SECTION_GAP = 16;
const sectionGap = (i: number) => !!props.groups && i > 0 && items.value[i]?.kind === 'group';
// cards: the task card is above the service rows; dragging is disabled there (dropAt counts by rowH)
const virt = useVirtualizer(
  computed(() => {
    const h = rowH.value;
    const card = asCards.value ? 88 : h;
    return {
      count: items.value.length,
      getScrollElement: () => scroller.value ?? null,
      estimateSize: (i: number) =>
        items.value[i]?.kind === 'task' ? card : sectionGap(i) ? h + SECTION_GAP : h,
      overscan: 8,
      getItemKey: (i: number) => items.value[i]?.id ?? i,
    };
  }),
);
// wrapped names: a task row grows only when the name needs more lines — its usual height is the minimum
// (a mobile task card — 64), the virtualizer measures it; service rows keep their height (PLANARAPP-62)
const measure = (el: unknown) => virt.value.measureElement(el as Element | null);
// the row being edited grows too: its name is a multi-line textarea (PLNRAPP-70); a card — always
const grows = (i: number) =>
  items.value[i]?.kind === 'task' &&
  (asCards.value ||
    narrow.value ||
    options.value.wrapTitles ||
    editing.value === items.value[i]?.id);
const rowStyle = (v: VirtualItem) => ({
  transform: `translateY(${v.start}px)`,
  ...(grows(v.index)
    ? { minHeight: `${isMobile.value ? 64 : rowH.value}px` }
    : { height: `${v.size}px` }),
});

// --- focus and keyboard
const focusedId = ref<string | null>(null);
const editing = ref<string | null>(null);
// sizes measured with wrapping (or while editing) are stale without it (and back)
watch(
  () => [options.value.wrapTitles, editing.value, asCards.value, narrow.value],
  () => virt.value.measure(),
);
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
  const it = list[i];
  // the subtasks tab (rootId) is inside the panel: moving in it does not switch the panel's task
  if (it.kind === 'task' && sideTaskOpen() && !props.rootId) showTask(it.task.key);
}
// the focused row is gone (filtered out, moved to another group): the same task if it is still in
// the list, else the next task, the previous one for the last (PLNRAPP-96)
watch(items, (now, before) => {
  const id = focusedId.value;
  if (!id || now.some((x) => x.id === id)) return;
  const i = before.findIndex((x) => x.id === id);
  if (i < 0) return;
  const rowOf = new Map(now.flatMap((x) => (x.kind === 'task' ? [[x.task.id, x.id]] : [])));
  const near = [before[i], ...before.slice(i + 1), ...before.slice(0, i).reverse()].find(
    (x) => x.kind === 'task' && rowOf.has(x.task.id),
  );
  focusedId.value = near?.kind === 'task' ? rowOf.get(near.task.id)! : null;
  const j = now.findIndex((x) => x.id === focusedId.value);
  if (j < 0) return;
  virt.value.scrollToIndex(j);
  // the side panel showed the task that left (its status changed there): the panel shows the new
  // focused one and keys go back to the list; focus lost with the removed row — too (PLNRAPP-107)
  const gone = before[i];
  const next = now[j];
  const shown =
    sideTaskOpen() &&
    gone.kind === 'task' &&
    router.currentRoute.value.query.task === gone.task.key;
  if (shown && next.kind === 'task') showTask(next.task.key);
  void nextTick(() => {
    const a = document.activeElement;
    if (shown || !a || a === document.body) scroller.value?.focus({ preventScroll: true });
  });
});
// focus lost (on the page after a dialog/panel/filter closes) or in the side panel: list keys still
// work (PLNRAPP-79); from the page — focus comes back to the list
function onWindowKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || scroller.value?.contains(t))
    return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
  const inSheet = sideTaskOpen() && !!t.closest('[data-testid=task-side]');
  // focus left on the clicked «Tasks» tab link (PLNRAPP-133): moving keys go to the list, Enter stays the link's
  const onTab = t.tagName === 'A' && !!t.closest('nav');
  if (t !== document.body && !inSheet && !onTab) return;
  const k = tokenOf(e);
  const move = ['j', 'k', 'ArrowDown', 'ArrowUp'].includes(k);
  if (onTab && !move) return;
  // in the panel: j/k anywhere; arrows from a control left focused after a picker (PLNRAPP-133), not
  // from the panel body — there they scroll it
  if (inSheet && k !== 'j' && k !== 'k' && !(move && t.tagName === 'BUTTON')) return;
  if (sideTaskOpen()) {
    const shown = router.currentRoute.value.query.task;
    const cur = items.value.find((x) => x.kind === 'task' && x.task.key === shown);
    if (cur) focusedId.value = cur.id;
  }
  if (!listKey(k)) return;
  e.preventDefault();
  if (!inSheet) scroller.value?.focus({ preventScroll: true });
}
onMounted(() => props.windowKeys && window.addEventListener('keydown', onWindowKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey));
function onKey(e: KeyboardEvent) {
  // list keys — when focus is on the list itself or on a row's button/checkbox (after a picker
  // focus returns to its button); not in input fields
  const t = e.target as HTMLElement;
  const onRowControl =
    t !== e.currentTarget &&
    !!t.closest('[role=row]') &&
    (t.tagName === 'BUTTON' || (t as HTMLInputElement).type === 'checkbox') &&
    ['j', 'k', 'x', 'd', 's', 'a', 'm'].includes(tokenOf(e));
  if ((t !== e.currentTarget && !onRowControl) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (listKey(tokenOf(e))) e.preventDefault();
}
// the task's own keys: with the side panel open its task is the focused one — the panel handles them
const pick = (task: TaskView, col: string, action: string) => {
  const row = scroller.value?.querySelector<HTMLElement>(`[data-task="${task.key}"]`);
  const btn = row?.querySelector<HTMLElement>(`[data-col=${col}] button`);
  if (!btn) return openTaskFor(task.key, action);
  // the closed picker returns focus to its button — back to the list, so j/k/Enter keep working
  row!.addEventListener('focusin', () => scroller.value?.focus({ preventScroll: true }), {
    once: true,
  });
  btn.click();
};
/** Runs a list key on the focused task; false — not a list key. */
function listKey(key: string): boolean {
  const task = focusedTask.value;
  const own = !sideTaskOpen();
  const handlers: Record<string, () => void> = {
    j: () => moveFocus(1),
    k: () => moveFocus(-1),
    ArrowDown: () => moveFocus(1),
    ArrowUp: () => moveFocus(-1),
    Enter: () => task && openKey(task.key),
    x: () => task && sel.toggle(task.id),
    F2: () => task && !asCards.value && startEdit(focusedId.value!), // edit, not opening after a click
    Escape: () => sel.clear(),
    ...(own && {
      d: () => task && void toggleToday(task),
      s: () => task && pick(task, 'status', 's'),
      a: () => task && pick(task, 'assignee', 'a'),
      m: () => task && openTaskFor(task.key, 'm'),
    }),
  };
  const h = handlers[key];
  if (!h) return false;
  h();
  return true;
}

function onRowClick(it: Extract<Item, { kind: 'task' }>, e: MouseEvent) {
  focusedId.value = it.id;
  // mobile (PLNRAPP-281): while something is selected, a tap toggles the task instead of opening it
  if (e.metaKey || e.ctrlKey || (isMobile.value && sel.selected.value.size)) sel.toggle(it.task.id);
  else if (e.shiftKey) sel.range(taskIds.value, it.task.id);
  else {
    // double-click on the name = edit: opening is deferred, dblclick cancels it
    clearTimeout(openTimer);
    openTimer = setTimeout(() => openKey(it.task.key), 250);
  }
}
function startEdit(id: string) {
  clearTimeout(openTimer);
  editing.value = id;
}
let openTimer: ReturnType<typeof setTimeout> | undefined;

// --- "New task" menu: module commands with newTaskMenu
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

// --- quick creation
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
  const by = options.value.groupBy;
  const k = g && g.key !== 'none' ? g.key : undefined;
  const target = props.scope?.createIn;
  const statusId = target
    ? createStatus(
        statuses.value ?? [],
        target.spaceId,
        by === 'status' ? k : undefined,
        !!statusKey.value,
        target.projectId,
      )
    : (by === 'status' && k) || defaultStatus.value;
  if (!title || !statusId) return;
  newTitle.value = '';
  await (props.source.create ?? createTask)({
    projectId: target?.projectId ?? props.projectId,
    statusId,
    title,
    ...(by === 'priority' && k && { priority: Number(k) }),
    ...(props.scope?.createAssigneeId && { assigneeIds: [props.scope.createAssigneeId] }),
    ...(by === 'assignee' && k && { assigneeIds: [k] }),
    ...(by === 'label' &&
      k && {
        labelIds: [labelFor(labels.value ?? [], target?.projectId ?? props.projectId, k)].filter(
          (x): x is string => !!x,
        ),
      }),
  });
}

// the first task in an empty project: the input field stays for the next one
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
          <Button
            v-if="quickCreate && (!scope || scope.createIn)"
            variant="primary"
            :icon="Plus"
            @click="startCreate('')"
            >{{ t('list.create') }}</Button
          >
          <Menu
            v-if="quickCreate && newMenu.length && !scope"
            :items="newMenu"
            :label="t('list.newMenu')"
          />
        </template>
      </template>
    </EmptyState>
    <TaskContextMenu v-else :space-id="spaceId" :tasks="all" selectable>
      <div
        ref="scroller"
        role="grid"
        tabindex="0"
        :aria-rowcount="items.length"
        class="min-h-0 flex-1 overflow-auto outline-none"
        :class="[
          narrow ? 'list-narrow' : 'list-wide',
          { 'focus-visible:ring-2 ring-inset ring-focus': !focusedTask },
        ]"
        @keydown="onKey"
      >
        <div class="relative w-full" :style="{ height: `${virt.getTotalSize()}px` }">
          <div
            v-if="drag?.drop.mode === 'slot'"
            class="pointer-events-none absolute right-0 z-10 h-0.5 bg-accent"
            :style="{ top: `${slotTop(drag.drop.slot) - 1}px`, left: `${40 + dropDepth * 20}px` }"
            data-testid="drop-line"
          />
          <div
            v-for="v in virt.getVirtualItems()"
            :key="String(v.key)"
            :ref="grows(v.index) ? measure : undefined"
            :data-index="v.index"
            class="absolute left-0 top-0 w-full"
            :style="rowStyle(v)"
          >
            <template v-for="it in [items[v.index]]" :key="it.id">
              <div
                v-if="it.kind === 'group'"
                role="row"
                :aria-rowindex="v.index + 1"
                class="flex h-full items-center gap-2 border-b border-border px-3 text-sm"
                :style="sectionGap(v.index) ? { paddingTop: `${SECTION_GAP}px` } : undefined"
                data-testid="group-row"
              >
                <button
                  v-if="!props.groups"
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
                <input
                  v-if="sel.active.value"
                  type="checkbox"
                  :checked="sel.state(it.group.tasks.map((x) => x.id)) === 'all'"
                  :indeterminate="sel.state(it.group.tasks.map((x) => x.id)) === 'some'"
                  :aria-label="t('list.selectGroup')"
                  class="size-4"
                  data-testid="select-group"
                  @click="sel.toggleAll(it.group.tasks.map((x) => x.id))"
                />
                <h3 v-if="props.groups" class="truncate text-sm font-semibold text-fg">
                  {{ it.group.label }}
                </h3>
                <!-- плашка группы цветом статуса/метки, как в ClickUp -->
                <span
                  v-else
                  class="truncate rounded px-2 py-0.5 text-xs font-semibold uppercase"
                  :class="it.group.color ? 'text-white' : 'bg-bg-muted text-fg'"
                  :style="it.group.color && { background: it.group.color }"
                  >{{ it.group.label }}</span
                >
                <span class="text-xs text-fg-subtle">{{ it.group.tasks.length }}</span>
                <slot name="group-actions" :group="it.group" />
              </div>
              <Row
                v-else-if="it.kind === 'task'"
                :task="it.task"
                :space-id="it.task.spaceId"
                :project-name="projectNames.get(it.task.projectId)"
                :widths="widths"
                :index="v.index + 1"
                :selected="sel.selected.value.has(it.task.id)"
                :selecting="sel.active.value"
                :focused="focusedId === it.id"
                :editing="editing === it.id"
                :fields="listFields"
                :narrow="narrow"
                :show-empty="density.showEmpty"
                :blocked="blocked.has(it.task.id)"
                :members="members ?? []"
                :labels="labels ?? []"
                :depth="it.depth"
                :parent="it.parent"
                :draggable="manual && !asCards"
                :wrap="density.wrapTitles"
                :show-key="density.showKey"
                :label-names="density.showLabelNames"
                :child-count="it.childCount"
                :folded="isFolded(it.task.id)"
                :class="[
                  dragIds.has(it.task.id) && 'opacity-40',
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
                class="flex h-full items-center border-b border-border px-3 pl-10 max-md:pl-3"
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

    <!-- PLNRAPP-294: превью группы у указателя — задача и бейдж «+N» -->
    <div
      v-if="drag && drag.ids.length > 1"
      class="pointer-events-none fixed z-50 flex max-w-72 items-center gap-2 rounded-md border border-border bg-bg px-2 py-1 text-sm shadow-lg"
      :style="{ left: `${drag.x + 12}px`, top: `${drag.y + 8}px` }"
      data-testid="drag-preview"
    >
      <span class="truncate">{{ drag.task.title }}</span>
      <span
        class="shrink-0 rounded-full bg-accent px-1.5 text-xs font-medium text-accent-fg"
        data-testid="drag-badge"
        >+{{ drag.ids.length - 1 }}</span
      >
    </div>
    <!-- no header row: «select all» is in the bar -->
    <BulkBar :space-id="spaceId" :tasks="all" :select-all="!asCards ? allIds : undefined" />
  </div>
</template>
