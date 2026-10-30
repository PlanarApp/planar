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
import { createStatus, fixPlan, useProjectNames, useStatusKey } from '../scope';
import { useBlockedIds } from '../../links';
import { LayoutDashboard } from 'lucide-vue-next';
import { EmptyState, useBreakpoint } from '../../ui';
import { openTask } from '..';
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

const project = useProject(() => props.projectId);
const spaceId = computed(() => props.scope?.spaceIds.join(',') ?? project.value?.spaceId ?? '');
const tasks = useScopeTasks(() => props.scope?.projectIds ?? [props.projectId]);
const statuses = useStatuses(spaceId);
const members = useMembers(spaceId);
const labels = useLabels(spaceId);
const blocked = useBlockedIds(() => props.projectId);
const passes = useTaskFilter(
  () => props.filter,
  statuses,
  () => props.options.me,
);
const statusKey = useStatusKey(() => props.scope, statuses);
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
    },
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
    planMove(columns.value, props.options.groupBy, id, from, to, beforeId),
    tasks.value?.find((x) => x.id === id),
    !!statusKey.value,
    statuses.value ?? [],
  );
  if (plan) await applyMove(plan);
}

function add(key: string, title: string) {
  const by = props.options.groupBy;
  const target = props.scope?.createIn;
  const statusId = target
    ? createStatus(
        statuses.value ?? [],
        target.spaceId,
        by === 'status' ? key : undefined,
        !!statusKey.value,
      )
    : by === 'status'
      ? key
      : (statuses.value?.find((s) => s.category === 'todo') ?? statuses.value?.[0])?.id;
  if (!statusId) return;
  void createTask({
    projectId: target?.projectId ?? props.projectId,
    statusId,
    title,
    ...(by === 'priority' && { priority: Number(key) }),
    ...(by === 'assignee' && key !== 'none' && { assigneeIds: [key] }),
    ...(by === 'label' && key !== 'none' && { labelIds: [key] }),
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
        class="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
        :class="isMobile && 'snap-x snap-mandatory scroll-px-3'"
        :style="mask"
        @scroll.passive="measure"
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
          :mobile="isMobile"
          :fields="options.fields"
          :blocked="blocked"
          :titles="titles"
          :space-id="scope ? undefined : spaceId"
          :show-empty="options.showEmpty"
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
