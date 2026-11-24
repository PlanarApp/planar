<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ChevronRight, UserPlus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import {
  AssigneePicker,
  StatusPicker,
  createTask,
  useLabels,
  useMembers,
  type TaskView,
} from '../tasks';
import { AvatarStack, Input, useBreakpoint } from '../ui';
import { avatarSrc } from '../pickers';
import { useBlockedIds } from '../links';
import { enabledForProject } from '../modules/registry';
import { useColumnWidths } from '../views/list/widths';
import { visibleColumns } from '../views/list/columns';
import { useSubtasks } from './queries';
import ListRow from '../views/list/Row.vue';
import TaskContextMenu from '../views/TaskContextMenu.vue';
import BulkBar from '../views/BulkBar.vue';
import { provideSelection, useSelectionReset } from '../views/selection';
import { dragSet, groupRanks, moveGroupLocal } from '../views/groupMove';
import { DEFAULT_OPTIONS, fieldModule } from '../views/options';

const props = defineProps<{ task: TaskView; statuses: Row<'statuses'>[] }>();
const emit = defineEmits<{ open: [key: string] }>();
const { t, locale } = useI18n();
const subtasks = useSubtasks(props.task.id);
const members = useMembers(() => props.task.spaceId);
const { isMobile } = useBreakpoint();
const labels = useLabels(
  () => props.task.spaceId,
  () => props.task.projectId,
);
// PLNRAPP-828: the rows as in the List view — its default fields (module ones only where the module is
// on), column auto-size by the subtasks, the "blocked" mark; a narrow area or mobile — the List card
const fields = computed(() =>
  DEFAULT_OPTIONS.fields.filter((f) => {
    const m = fieldModule(f);
    return !m || enabledForProject(m, [props.task.projectId]);
  }),
);
const blocked = useBlockedIds(() => props.task.projectId);
const { widths } = useColumnWidths(
  () => `subtasks:${props.task.projectId}`,
  () => visibleColumns(fields.value),
  subtasks,
  () => ({
    labels: new Map((labels.value ?? []).map((l) => [l.id, l.name])),
    projects: new Map(),
    header: () => '',
    priority: (p) => t(`tasks.priority.${p}`),
    locale: locale.value,
  }),
);
const editing = ref<string | null>(null);
const title = ref('');
const status = (id: string) => props.statuses.find((x) => x.id === id);
// closed: categories done and cancelled
const isClosed = (x: TaskView) =>
  ['done', 'cancelled'].includes(status(x.statusId)?.category ?? '');
const open = computed(() => (subtasks.value ?? []).filter((x) => !isClosed(x)));
const closed = computed(() => (subtasks.value ?? []).filter(isClosed));
const done = computed(() => closed.value.length);
// the "Closed N" accordion: collapsed on every opening of the card, not saved (PLNRAPP-542)
const showClosed = ref(false);

// the List's actions (PLNRAPP-541): own selection (not the view's under the side panel), the context
// menu and the bulk bar for it, the manual order by dragging
const sel = provideSelection();
const root = ref<HTMLElement>();
useSelectionReset(() => root.value, sel);
// as in the List (PLNRAPP-817): the area under half of the window (the task sidebar, a small window) —
// the rows are the List cards
const areaW = ref(0);
const half = ref(0);
let ro: ResizeObserver | undefined;
const fit = () => {
  areaW.value = root.value?.clientWidth ?? 0;
  half.value = window.innerWidth / 2;
};
const narrow = computed(() => areaW.value > 0 && areaW.value < half.value);
watch(root, (el) => {
  ro?.disconnect();
  if (el && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(fit);
    ro.observe(el);
  }
  fit();
});
onBeforeUnmount(() => ro?.disconnect());
const shown = computed(() => [...open.value, ...(showClosed.value ? closed.value : [])]);
function onClick(s: TaskView, e: MouseEvent) {
  // as in the List: Ctrl/⌘ — toggle, Shift — a range; mobile with a selection — a tap toggles
  if (e.metaKey || e.ctrlKey || (isMobile.value && sel.active.value)) sel.toggle(s.id);
  else if (e.shiftKey)
    sel.range(
      shown.value.map((x) => x.id),
      s.id,
    );
  else emit('open', s.key);
}

// dragging: inside its block (open / closed); a selected subtask takes the selected ones of the block
const openEl = ref<HTMLElement>();
const closedEl = ref<HTMLElement>();
const drag = ref<{ ids: string[]; list: 'open' | 'closed'; slot: number; top: number } | null>(
  null,
);
const dragIds = computed(() => new Set(drag.value?.ids));
const blockOf = (list: 'open' | 'closed') =>
  list === 'open'
    ? { tasks: open.value, el: openEl.value }
    : { tasks: closed.value, el: closedEl.value };
/** the drop slot (0…n) by the pointer and the indicator line's top in the block */
function slotAt(el: HTMLElement, y: number) {
  const box = el.getBoundingClientRect();
  const rows = [...el.querySelectorAll<HTMLElement>('[data-task]')].map((r) =>
    r.getBoundingClientRect(),
  );
  const slot = rows.filter((r) => r.top + r.height / 2 < y).length;
  const top = (slot < rows.length ? rows[slot]!.top : (rows.at(-1)?.bottom ?? box.top)) - box.top;
  return { slot, top };
}
function onMove(e: PointerEvent) {
  const d = drag.value;
  const el = d && blockOf(d.list).el;
  if (d && el) Object.assign(d, slotAt(el, e.clientY));
}
function stop() {
  removeEventListener('pointermove', onMove);
  removeEventListener('pointerup', onUp);
}
onBeforeUnmount(stop);
function startDrag(s: TaskView, list: 'open' | 'closed', e: PointerEvent) {
  const { tasks, el } = blockOf(list);
  if (!el) return;
  const ids = dragSet(
    sel.selected.value,
    s.id,
    tasks.map((x) => x.id),
  );
  if (!sel.selected.value.has(s.id) && sel.active.value) sel.clear();
  drag.value = { ids, list, ...slotAt(el, e.clientY) };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
}
async function onUp() {
  stop();
  const d = drag.value;
  drag.value = null;
  if (!d) return;
  const moved = new Set(d.ids);
  // before the first not moved subtask from the slot on; none — after the last of the block
  const { tasks } = blockOf(d.list);
  const rest = tasks.filter((x) => !moved.has(x.id));
  const before = tasks.slice(d.slot).find((x) => !moved.has(x.id));
  const last = before ? undefined : rest.at(-1);
  // ranks among all the subtasks (by rank, without the moved ones)
  const all = (subtasks.value ?? []).filter((x) => !moved.has(x.id));
  const at = before ? all.indexOf(before) : last ? all.indexOf(last) + 1 : all.length;
  const beforeId = all[at]?.id ?? null;
  const group = (subtasks.value ?? []).filter((x) => moved.has(x.id));
  // the order has not changed — nothing to save
  const now = (subtasks.value ?? []).map((x) => x.id);
  const next = [...all.slice(0, at), ...group, ...all.slice(at)].map((x) => x.id);
  if (now.join() === next.join()) return;
  const { ranks, rerank } = groupRanks(all, beforeId, group.length);
  await moveGroupLocal({
    tasks: group,
    by: 'none',
    from: () => 'none',
    to: 'none',
    ranks,
    rerank,
  });
}

// PLNRAPP-828: the new subtask's status and assignees — chosen by the buttons right of the input;
// the status by default — the first one of the project (PJ-1); the choice stays for the next subtasks
const projectStatuses = computed(() =>
  props.statuses.filter((x) => x.projectId === props.task.projectId),
);
const newStatus = ref<string>();
watch(
  projectStatuses,
  (all) => {
    if (!all.some((x) => x.id === newStatus.value)) newStatus.value = all[0]?.id;
  },
  { immediate: true },
);
const newAssignees = ref<string[]>([]);
const newPeople = computed(() =>
  newAssignees.value
    .map((id) => members.value?.find((m) => m.id === id))
    .filter((m) => !!m)
    .map((m) => ({ name: m.name, src: avatarSrc(m) })),
);
async function add() {
  const s = title.value.trim();
  const statusId = newStatus.value;
  if (!s || !statusId) return;
  title.value = '';
  await createTask({
    projectId: props.task.projectId,
    statusId,
    title: s,
    parentId: props.task.id,
    ...(newAssignees.value.length && { assigneeIds: [...newAssignees.value] }),
  });
}
</script>

<template>
  <section ref="root" :aria-label="t('task.subtasks')">
    <!-- the title is the tab (PLNRAPP-100) -->
    <div v-if="subtasks?.length" class="mb-1 flex items-center gap-3">
      <span class="text-xs text-fg-muted" data-testid="subtasks-progress">{{
        t('task.subtasksDone', { done, n: subtasks.length })
      }}</span>
      <div class="h-1.5 w-24 overflow-hidden rounded-full bg-bg-muted">
        <div
          class="h-full rounded-full bg-success"
          :style="{ width: `${(done / subtasks.length) * 100}%` }"
        />
      </div>
    </div>
    <!-- PLNRAPP-541: the List's context menu, selection and bulk bar — for the subtasks -->
    <TaskContextMenu :space-id="task.spaceId" :tasks="subtasks" selectable>
      <div>
        <div
          v-if="open.length"
          ref="openEl"
          role="grid"
          :aria-label="t('task.subtasks')"
          class="relative mb-1 overflow-hidden rounded-lg border border-border [&>*:last-child]:border-b-0"
          data-testid="subtasks-list"
        >
          <div
            v-if="drag?.list === 'open'"
            class="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-accent"
            :style="{ top: `${drag.top - 1}px` }"
            data-testid="drop-line"
          />
          <ListRow
            v-for="(s, i) in open"
            :key="s.id"
            :class="['min-h-16 cursor-pointer md:min-h-8', dragIds.has(s.id) && 'opacity-40']"
            :task="s"
            :space-id="task.spaceId"
            :index="i + 1"
            :selected="sel.selected.value.has(s.id)"
            :selecting="sel.active.value"
            :focused="false"
            :editing="editing === s.id"
            :fields="fields"
            :widths="widths"
            :narrow="narrow"
            :blocked="blocked.has(s.id)"
            :members="members ?? []"
            :labels="labels ?? []"
            :draggable="!isMobile"
            show-key
            @click="onClick(s, $event)"
            @toggle="sel.toggle(s.id)"
            @drag="startDrag(s, 'open', $event)"
            @edit="editing = s.id"
            @done="editing = null"
          />
        </div>
        <div v-if="closed.length" class="mb-1">
          <button
            type="button"
            class="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-fg-muted hover:text-fg"
            :aria-expanded="showClosed"
            data-testid="subtasks-closed"
            @click="showClosed = !showClosed"
          >
            <ChevronRight
              :size="12"
              :class="['shrink-0 transition-transform', showClosed && 'rotate-90']"
            />{{ t('task.subtasksClosed', { n: closed.length }) }}
          </button>
          <div
            v-if="showClosed"
            ref="closedEl"
            role="grid"
            :aria-label="t('task.subtasks')"
            class="relative mb-1 overflow-hidden rounded-lg border border-border [&>*:last-child]:border-b-0"
            data-testid="subtasks-closed-list"
          >
            <div
              v-if="drag?.list === 'closed'"
              class="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-accent"
              :style="{ top: `${drag.top - 1}px` }"
              data-testid="drop-line"
            />
            <ListRow
              v-for="(s, i) in closed"
              :key="s.id"
              :class="['min-h-16 cursor-pointer md:min-h-8', dragIds.has(s.id) && 'opacity-40']"
              :task="s"
              :space-id="task.spaceId"
              :index="open.length + i + 1"
              :selected="sel.selected.value.has(s.id)"
              :selecting="sel.active.value"
              :focused="false"
              :editing="editing === s.id"
              :fields="fields"
              :widths="widths"
              :narrow="narrow"
              :blocked="blocked.has(s.id)"
              :members="members ?? []"
              :labels="labels ?? []"
              :draggable="!isMobile"
              show-key
              @click="onClick(s, $event)"
              @toggle="sel.toggle(s.id)"
              @drag="startDrag(s, 'closed', $event)"
              @edit="editing = s.id"
              @done="editing = null"
            />
          </div>
        </div>
      </div>
    </TaskContextMenu>
    <BulkBar :space-id="task.spaceId" :tasks="subtasks" />
    <form class="flex items-center gap-1" data-testid="subtask-add" @submit.prevent="add">
      <Input
        v-model="title"
        class="min-w-0 flex-1"
        :label="t('task.addSubtask')"
        hide-label
        :placeholder="t('task.addSubtask')"
      />
      <!-- PLNRAPP-828: the new subtask's status and assignees (the common user picker) -->
      <StatusPicker
        v-model="newStatus"
        :space-id="task.spaceId"
        :project-id="task.projectId"
        data-testid="subtask-new-status"
      />
      <AssigneePicker
        v-model="newAssignees"
        :space-id="task.spaceId"
        data-testid="subtask-new-assignees"
      >
        <template #value>
          <AvatarStack v-if="newPeople.length" :people="newPeople" />
          <UserPlus v-else :size="16" class="text-fg-muted" />
        </template>
      </AssigneePicker>
    </form>
  </section>
</template>
