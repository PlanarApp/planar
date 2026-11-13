<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createTask,
  useLabels,
  useMembers,
  useProject,
  useScopeTasks,
  updateTask,
  useStatuses,
} from '../../tasks';
import {
  createStatus,
  defaultStatus,
  dictProjectOf,
  fixPlan,
  labelFor,
  useLabelKey,
  useProjectNames,
  useStatusKey,
  useWidenedFilter,
} from '../scope';
import { useBlockedIds } from '../../links';
import { LayoutDashboard } from 'lucide-vue-next';
import { EmptyState, useBreakpoint } from '../../ui';
import { openTask, useSelection } from '..';
import { showTask, sideTaskOpen } from '../open';
import { useLostFocusKeys } from '../keys';
import { tokenOf } from '../../command/hotkeys';
import type { ViewProps } from '..';
import { useTaskFilter } from '../saved/useFilter';
import Column from './Column.vue';
import TaskContextMenu from '../TaskContextMenu.vue';
import BulkBar from '../BulkBar.vue';
import { applyMove, boardColumns, planMove } from './plan';
import { VueDraggable } from 'vue-draggable-plus';
import { mutate, rankBetween } from '../../sync';

const props = defineProps<ViewProps>();
const { t } = useI18n();
const { isMobile } = useBreakpoint();
const sel = useSelection();

const project = useProject(() => props.projectId);
const spaceId = computed(() => props.scope?.spaceIds.join(',') ?? project.value?.spaceId ?? '');
const tasks = useScopeTasks(() => props.scope?.projectIds ?? [props.projectId]);
// a project board reads its own dictionaries; a summary — those of all its projects (grouped by name)
const dictProject = () => dictProjectOf(props.scope, props.projectId);
const statuses = useStatuses(spaceId, dictProject);
const members = useMembers(spaceId);
const labels = useLabels(spaceId, dictProject);
const blocked = useBlockedIds(() => props.projectId);
const passes = useTaskFilter(
  useWidenedFilter(() => props.filter),
  statuses,
  () => props.options.me,
);
const statusKey = useStatusKey(() => props.scope, statuses);
const labelKey = useLabelKey(() => props.scope, labels);
const projectNames = useProjectNames();

const columns = computed(() =>
  boardColumns(
    (tasks.value ?? []).filter(
      (x) => (props.options.showSubtasks || !x.parentId) && passes.value(x),
    ),
    props.options.groupBy,
    {
      statuses: statuses.value ?? [],
      members: members.value ?? [],
      labels: labels.value ?? [],
      statusKey: statusKey.value,
      labelKey: labelKey.value,
    },
  ).filter(
    (g) => props.options.groupBy === 'none' || !props.options.hideEmptyGroups || g.tasks.length,
  ),
);

const titles = computed(() => new Map((tasks.value ?? []).map((x) => [x.id, x.title])));

const storeKey = () => `planar.board.${props.projectId}.collapsed`;
const collapsed = ref<Set<string>>(new Set());
watch(
  () => props.projectId,
  () => {
    try {
      collapsed.value = new Set(JSON.parse(localStorage.getItem(storeKey()) ?? '[]'));
    } catch {
      collapsed.value = new Set();
    }
  },
  { immediate: true },
);
function toggle(key: string) {
  const s = new Set(collapsed.value);
  if (!s.delete(key)) s.add(key);
  collapsed.value = s;
  try {
    localStorage.setItem(storeKey(), JSON.stringify([...s]));
  } catch {
    // quota or private mode — the collapsed state lives until reload
  }
}

// mask at the edge of the horizontal column scroll (as on the tab strip)
const scroller = ref<HTMLElement>();
const fade = ref({ l: false, r: false });
const measure = () => {
  const el = scroller.value;
  if (el)
    fade.value = {
      l: el.scrollLeft > 1,
      r: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
};
const mask = computed(() => {
  const { l, r } = fade.value;
  if (!l && !r) return undefined;
  const g = `linear-gradient(to right, ${l ? 'transparent, #000 40px' : '#000, #000'}, ${r ? '#000 calc(100% - 40px), transparent' : '#000, #000'})`;
  return { maskImage: g, WebkitMaskImage: g };
});
let ro: ResizeObserver | undefined;
watch(scroller, (el) => {
  ro?.disconnect();
  if (el && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
  }
  measure();
});
watch(columns, () => void nextTick(measure));
onBeforeUnmount(() => ro?.disconnect());

// desktop: drag the empty space with the mouse to scroll horizontally (touch scrolls natively)
let pan: { x: number; left: number } | undefined;
function panStart(e: PointerEvent) {
  const el = scroller.value;
  if (e.pointerType !== 'mouse' || e.button !== 0 || !el) return;
  const skip = '[data-id],[data-col-handle],button,a,input,textarea,[contenteditable]';
  if ((e.target as Element).closest(skip)) return;
  pan = { x: e.clientX, left: el.scrollLeft };
  el.setPointerCapture(e.pointerId);
}
function panMove(e: PointerEvent) {
  if (pan && scroller.value) scroller.value.scrollLeft = pan.left - (e.clientX - pan.x);
}
const panEnd = () => (pan = undefined);

// status order — by dragging the column headers (grouping by status)
async function onColumnsEnd(e: { oldDraggableIndex?: number; newDraggableIndex?: number }) {
  const o = e.oldDraggableIndex;
  const n = e.newDraggableIndex;
  if (o === undefined || n === undefined || o === n) return;
  const st = columns.value.map((c) => statuses.value?.find((s) => s.id === c.key));
  const moved = st[o];
  if (!moved || st.some((x) => !x)) return;
  const rest = st.filter((x) => x !== moved);
  await mutate('status.update', {
    id: moved.id,
    rank: rankBetween(rest[n - 1]?.rank ?? null, rest[n]?.rank ?? null),
  });
}

async function move(id: string, from: string, to: string, beforeId: string | null) {
  // multi-space summary: the column is the status name; we set the same-named status of the task's space
  const plan = fixPlan(
    planMove(columns.value, props.options.groupBy, id, from, to, beforeId, labelKey.value),
    tasks.value?.find((x) => x.id === id),
    !!statusKey.value,
    statuses.value ?? [],
    labels.value ?? [],
  );
  if (plan) await applyMove(plan);
}

// --- focus and keyboard (as in the List): j/k/↑/↓ — in the column, ←/→ — to the neighbouring column
// (collapsed and empty ones are skipped), Enter opens, x selects, Escape clears the selection
const focusedId = ref<string | null>(null);
const open = computed(() => columns.value.filter((c) => !collapsed.value.has(c.key)));
const where = (cols: typeof columns.value, id: string | null) => {
  for (let c = 0; c < cols.length; c++) {
    const r = cols[c].tasks.findIndex((x) => x.id === id);
    if (r >= 0) return { c, r };
  }
  return null;
};
const focusedTask = computed(() => {
  const p = where(open.value, focusedId.value);
  return p ? open.value[p.c].tasks[p.r] : undefined;
});
function focusAt(c: number, r: number) {
  const tasks = open.value[c]?.tasks;
  if (!tasks?.length) return;
  const task = tasks[Math.min(Math.max(r, 0), tasks.length - 1)];
  focusedId.value = task.id;
  if (sideTaskOpen()) showTask(task.key);
}
function moveFocus(dc: number, dr: number) {
  const cols = open.value;
  const p = where(cols, focusedId.value);
  if (!p) {
    const c = cols.findIndex((x) => x.tasks.length);
    return focusAt(c, 0);
  }
  if (dr) return focusAt(p.c, p.r + dr);
  for (let c = p.c + dc; c >= 0 && c < cols.length; c += dc)
    if (cols[c].tasks.length) return focusAt(c, p.r);
}
// the focused card is gone (filtered out, column collapsed): the card now at its place
watch(open, (now, before) => {
  if (!focusedId.value || where(now, focusedId.value)) return;
  const p = where(before, focusedId.value);
  const c = p && now.findIndex((x) => x.key === before[p.c].key);
  focusedId.value = null;
  if (p && c !== null && c >= 0 && now[c].tasks.length)
    focusedId.value = now[c].tasks[Math.min(p.r, now[c].tasks.length - 1)].id;
});
function boardKey(key: string): boolean {
  const task = focusedTask.value;
  const handlers: Record<string, () => void> = {
    j: () => moveFocus(0, 1),
    k: () => moveFocus(0, -1),
    ArrowDown: () => moveFocus(0, 1),
    ArrowUp: () => moveFocus(0, -1),
    ArrowLeft: () => moveFocus(-1, 0),
    ArrowRight: () => moveFocus(1, 0),
    Enter: () => task && openTask(task.key),
    x: () => task && sel.toggle(task.id),
    Escape: () => sel.clear(),
  };
  const h = handlers[key];
  if (!h) return false;
  h();
  return true;
}
const cardOf = (t: EventTarget | null) =>
  t instanceof HTMLElement && t.matches('[data-id][data-task]') ? t : null;
// a card got focus (Tab, click) — it is the focused one
function onFocusIn(e: FocusEvent) {
  const id = cardOf(e.target)?.dataset.id;
  if (id) focusedId.value = id;
}
function onKey(e: KeyboardEvent) {
  // on the board itself or on a card; not in fields and buttons of the cards
  const card = cardOf(e.target);
  if ((e.target !== e.currentTarget && !card) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!boardKey(tokenOf(e))) return;
  e.preventDefault();
  // the ring moves away from the card: focus goes to the board, so the card does not stay ringed
  if (card) scroller.value?.focus({ preventScroll: true });
}
useLostFocusKeys(
  () => scroller.value,
  boardKey,
  (key) => {
    const cur = open.value.flatMap((c) => c.tasks).find((x) => x.key === key);
    if (cur) focusedId.value = cur.id;
  },
);
watch(
  () => props.projectId,
  () => (focusedId.value = null),
);

function add(key: string, title: string) {
  const by = props.options.groupBy;
  const target = props.scope?.createIn;
  const statusId = target
    ? createStatus(
        statuses.value ?? [],
        target.spaceId,
        by === 'status' ? key : undefined,
        !!statusKey.value,
        target.projectId,
      )
    : by === 'status'
      ? key
      : defaultStatus(statuses.value ?? [], props.projectId);
  if (!statusId) return;
  void createTask({
    projectId: target?.projectId ?? props.projectId,
    statusId,
    title,
    ...(by === 'priority' && { priority: Number(key) }),
    ...(props.scope?.createAssigneeId && { assigneeIds: [props.scope.createAssigneeId] }),
    ...(by === 'assignee' && key !== 'none' && { assigneeIds: [key] }),
    ...(by === 'label' &&
      key !== 'none' && {
        labelIds: [labelFor(labels.value ?? [], target?.projectId ?? props.projectId, key)].filter(
          (x): x is string => !!x,
        ),
      }),
  });
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <EmptyState
      v-if="tasks && !tasks.length"
      class="!pt-6 !pb-2"
      :icon="LayoutDashboard"
      :title="t('list.emptyTitle')"
      :description="t('views.emptyBoard')"
    />
    <TaskContextMenu :space-id="spaceId" :tasks="tasks">
      <VueDraggable
        :ref="(c) => (scroller = (c as { $el?: HTMLElement } | null)?.$el)"
        :model-value="columns"
        group="columns"
        handle="[data-col-handle]"
        draggable="[data-column]"
        filter="button"
        :prevent-on-filter="false"
        :disabled="options.groupBy !== 'status' || !!scope"
        :animation="150"
        :delay="300"
        :delay-on-touch-only="true"
        tabindex="0"
        class="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 outline-none ring-inset ring-focus"
        :class="[
          isMobile && 'snap-x snap-mandatory scroll-px-3',
          !focusedTask && 'focus-visible:ring-2',
        ]"
        :style="mask"
        @keydown="onKey"
        @focusin="onFocusIn"
        @scroll.passive="measure"
        @pointerdown="panStart"
        @pointermove="panMove"
        @pointerup="panEnd"
        @pointercancel="panEnd"
        @end="onColumnsEnd"
        role="group"
        :aria-label="t('views.board')"
      >
        <Column
          v-for="g in columns"
          :key="g.key"
          :group="g"
          :members="members ?? []"
          :labels="labels ?? []"
          :collapsed="collapsed.has(g.key)"
          :focused-id="focusedTask?.id ?? null"
          :mobile="isMobile"
          :fields="options.fields"
          :blocked="blocked"
          :titles="titles"
          :space-id="scope ? undefined : spaceId"
          :show-empty="options.showEmpty"
          :show-key="options.showKey"
          :wrap="options.wrapTitles"
          :projects="projectNames"
          :sortable="options.groupBy === 'status' && !scope"
          :no-add="!!scope && !scope.createIn"
          @toggle="toggle(g.key)"
          @open="openTask"
          @add="add(g.key, $event)"
          @move="move"
        />
      </VueDraggable>
    </TaskContextMenu>
    <BulkBar :space-id="spaceId" :tasks="tasks" />
  </div>
</template>
