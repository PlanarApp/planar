<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createTask,
  useLabels,
  useMembers,
  useProject,
  useProjectTasks,
  useStatuses,
} from '../../tasks';
import { useBreakpoint } from '../../ui';
import { openTask } from '..';
import type { ViewProps } from '..';
import Column from './Column.vue';
import { applyMove, boardColumns, planMove } from './plan';

const props = defineProps<ViewProps>();
const { t } = useI18n();
const { isMobile } = useBreakpoint();

const project = useProject(() => props.projectId);
const spaceId = computed(() => project.value?.spaceId ?? '');
const tasks = useProjectTasks(() => props.projectId);
const statuses = useStatuses(spaceId);
const members = useMembers(spaceId);
const labels = useLabels(spaceId);

const columns = computed(() =>
  boardColumns(
    (tasks.value ?? []).filter((x) => props.options.showSubtasks || !x.parentId),
    props.options.groupBy,
    { statuses: statuses.value ?? [], members: members.value ?? [], labels: labels.value ?? [] },
  ),
);

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
    // квота или приватный режим — свёрнутость живёт до перезагрузки
  }
}

async function move(id: string, from: string, to: string, beforeId: string | null) {
  const plan = planMove(columns.value, props.options.groupBy, id, from, to, beforeId);
  if (plan) await applyMove(plan);
}

function add(key: string, title: string) {
  const by = props.options.groupBy;
  const statusId = by === 'status' ? key : statuses.value?.[0]?.id;
  if (!statusId) return;
  void createTask({
    projectId: props.projectId,
    statusId,
    title,
    ...(by === 'priority' && { priority: Number(key) }),
    ...(by === 'assignee' && key !== 'none' && { assigneeIds: [key] }),
    ...(by === 'label' && key !== 'none' && { labelIds: [key] }),
  });
}
</script>

<template>
  <div
    class="flex h-full gap-3 overflow-x-auto p-3"
    :class="isMobile && 'snap-x snap-mandatory'"
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
      @toggle="toggle(g.key)"
      @open="openTask"
      @add="add(g.key, $event)"
      @move="move"
    />
  </div>
</template>
