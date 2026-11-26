<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VueDraggable } from 'vue-draggable-plus';
import {
  CornerDownRight,
  IndentDecrease,
  IndentIncrease,
  SquarePlus,
  Trash2,
  UserPlus,
} from '@lucide/vue';
import { CHECKLIST_MAX_INDENT, type Row } from '@planar/shared';
import { db, mutate, newId, rankBetween, useQuery } from '../sync';
import { Avatar, Input, Menu, type MenuItem } from '../ui';
import { createTask, useMembers } from '../tasks';
import { UserPicker, avatarSrc } from '../pickers';
import { useChecklist } from './queries';
import WorkStatus from './WorkStatus.vue';
import { TASK_ACTIVITY, activityOf } from '../modules/activity';

const props = defineProps<{
  taskId: string;
  spaceId: string;
  projectId: string;
  statuses: Row<'statuses'>[];
}>();
const emit = defineEmits<{ open: [key: string] }>();
const { t } = useI18n();
// PLNRAPP-202: the AI works on an item — a ring around its avatar while it runs, the line of its state
const taskWork = inject(TASK_ACTIVITY, null);
const workOf = (itemId: string) =>
  taskWork
    ? activityOf(
        taskWork.items.value.filter((a) => a.state !== 'done'),
        itemId,
      )
    : undefined;
// an item turned into a task (PLNRAPP-142): key of the task for the link; a deleted task — plain text
const linked = useQuery(async () => {
  const items = await db
    .table<Row<'checklistItems'>>('checklistItems')
    .where('taskId')
    .equals(props.taskId)
    .toArray();
  const ids = items.flatMap((i) => (i.linkedTaskId ? [i.linkedTaskId] : []));
  const tasks = (await db.table<Row<'tasks'>>('tasks').bulkGet(ids)).filter((x) => !!x);
  const projects = await db
    .table<Row<'projects'>>('projects')
    .bulkGet([...new Set(tasks.map((x) => x.projectId))]);
  const keys = new Map(projects.flatMap((p) => (p ? [[p.id, p.key] as const] : [])));
  return new Map(tasks.map((x) => [x.id, `${keys.get(x.projectId) ?? '?'}-${x.number ?? '…'}`]));
});
const keyOf = (i: Row<'checklistItems'>) =>
  i.linkedTaskId ? linked.value?.get(i.linkedTaskId) : undefined;

/** the item → a task (or a subtask of this one); the item stays, its text links to the task */
async function toTask(i: Row<'checklistItems'>, sub: boolean) {
  const status = props.statuses.find((x) => x.projectId === props.projectId); // PJ-1, as Subtasks
  if (!status) return;
  const id = await createTask({
    projectId: props.projectId,
    statusId: status.id,
    title: i.text,
    parentId: sub ? props.taskId : null,
    assigneeIds: i.assigneeId ? [i.assigneeId] : undefined,
  });
  await mutate('checklist.update', { id: i.id, linkedTaskId: id });
}
const itemMenu = (i: Row<'checklistItems'>): MenuItem[] => [
  {
    id: 'indent',
    label: t('task.checklistIndent'),
    icon: IndentIncrease,
    disabled: levelOf(i) >= maxAfter(prevOf(i)),
    onSelect: () => setLevel(i, levelOf(i) + 1),
  },
  {
    id: 'outdent',
    label: t('task.checklistOutdent'),
    icon: IndentDecrease,
    disabled: levelOf(i) === 0,
    onSelect: () => setLevel(i, levelOf(i) - 1),
  },
  { separator: true as const },
  ...(i.linkedTaskId
    ? []
    : [
        {
          id: 'task',
          label: t('task.checklistToTask'),
          icon: SquarePlus,
          onSelect: () => void toTask(i, false),
        },
        {
          id: 'subtask',
          label: t('task.checklistToSubtask'),
          icon: CornerDownRight,
          onSelect: () => void toTask(i, true),
        },
        { separator: true as const },
      ]),
  {
    id: 'delete',
    label: t('task.delete'),
    icon: Trash2,
    danger: true,
    onSelect: () => void mutate('checklist.delete', { id: i.id }),
  },
];
const items = useChecklist(props.taskId);
const text = ref('');

// nesting (PLNRAPP-143), as in a document list: the shown level is at most the previous item's + 1
const depth = computed(() => {
  const m = new Map<string, number>();
  let prev = -1;
  for (const i of items.value ?? []) m.set(i.id, (prev = Math.min(i.indent ?? 0, prev + 1)));
  return m;
});
const levelOf = (i: Row<'checklistItems'>) => depth.value.get(i.id) ?? 0;
const prevOf = (i: Row<'checklistItems'>) => {
  const list = items.value ?? [];
  return list[list.findIndex((x) => x.id === i.id) - 1];
};
/** deepest level of an item placed after `prev` */
const maxAfter = (prev: Row<'checklistItems'> | undefined) =>
  prev ? Math.min(CHECKLIST_MAX_INDENT, levelOf(prev) + 1) : 0;
const setLevel = (i: Row<'checklistItems'>, indent: number) =>
  void mutate('checklist.update', { id: i.id, indent });

// local list for Sortable; the source of truth is the replica
const list = ref<Row<'checklistItems'>[]>([]);
watch(items, (v) => (list.value = [...(v ?? [])]), { immediate: true });
/** drag-and-drop: rank between the neighbours; the dropped item takes the level of the one above */
function moved(id: string, index: number) {
  const others = (items.value ?? []).filter((x) => x.id !== id);
  const prev = others[index - 1];
  void mutate('checklist.update', {
    id,
    rank: rankBetween(prev?.rank ?? null, others[index]?.rank ?? null),
    indent: prev ? levelOf(prev) : 0,
  });
}

// Tab / Shift+Tab in the new item field — its level; an empty field lets Tab move focus
const newIndent = ref(0);
const newMax = computed(() => maxAfter(items.value?.at(-1)));
function onTab(e: KeyboardEvent) {
  if (!text.value) return;
  e.preventDefault();
  newIndent.value = Math.max(0, Math.min(newIndent.value + (e.shiftKey ? -1 : 1), newMax.value));
}
// an item is assigned as a comment (PLNRAPP-140): the common user picker over the space members
const members = useMembers(() => props.spaceId);
const userOf = (id: string | null | undefined) => members.value?.find((u) => u.id === id);

async function add() {
  const s = text.value.trim();
  if (!s) return;
  text.value = '';
  const last = items.value?.at(-1)?.rank ?? null;
  await mutate('checklist.add', {
    id: newId(),
    taskId: props.taskId,
    text: s,
    rank: rankBetween(last, null),
    indent: Math.min(newIndent.value, newMax.value),
  });
}
</script>

<template>
  <section :aria-label="t('task.checklist')">
    <!-- the title and done/total are on the tab (PLNRAPP-100, -102) -->
    <VueDraggable
      v-model="list"
      tag="ul"
      handle=".handle"
      @update="(e) => moved(e.data.id, e.newIndex!)"
    >
      <li
        v-for="i in list"
        :key="i.id"
        class="group flex min-h-11 items-center gap-2 md:min-h-8"
        :style="{ paddingLeft: `${levelOf(i) * 1.5}rem` }"
        :data-level="levelOf(i)"
        data-testid="checklist-item"
      >
        <span
          class="handle cursor-grab select-none text-fg-subtle md:opacity-0 md:group-hover:opacity-100"
          aria-hidden="true"
          >⋮⋮</span
        >
        <input
          type="checkbox"
          :checked="i.done"
          :aria-label="i.text"
          class="size-4 accent-[var(--color-accent)]"
          @change="mutate('checklist.update', { id: i.id, done: !i.done })"
        />
        <span :class="['flex-1', i.done && 'text-fg-subtle line-through']">
          <a
            v-if="keyOf(i)"
            :href="`/t/${keyOf(i)}`"
            :title="keyOf(i)"
            class="text-accent hover:underline"
            data-testid="checklist-link"
            @click.prevent="emit('open', keyOf(i)!)"
            >{{ i.text }}</a
          >
          <template v-else>{{ i.text }}</template>
        </span>
        <WorkStatus
          v-if="workOf(i.id)"
          :activity="workOf(i.id)!"
          class="shrink-0"
          @open="taskWork?.open"
          @cancel="taskWork?.cancel"
        />
        <UserPicker
          v-if="members?.length"
          :users="members"
          :selected="i.assigneeId ? [i.assigneeId] : []"
          :title="
            i.assigneeId
              ? t('task.assignedTo', { name: userOf(i.assigneeId)?.name ?? '?' })
              : t('task.assignComment')
          "
          :none="i.assigneeId ? t('task.unassignComment') : undefined"
          @pick="(id) => void mutate('checklist.update', { id: i.id, assigneeId: id })"
        >
          <template #value>
            <Avatar
              v-if="i.assigneeId"
              :name="userOf(i.assigneeId)?.name ?? '?'"
              :src="avatarSrc(userOf(i.assigneeId))"
              size="sm"
              :class="workOf(i.id)?.state === 'running' && 'work-ring'"
              data-testid="checklist-assignee"
            />
            <UserPlus
              v-else
              :size="16"
              class="text-fg-muted md:opacity-0 md:group-hover:opacity-100"
              data-testid="checklist-assign"
            />
          </template>
        </UserPicker>
        <!-- «…» instead of the delete cross (PLNRAPP-142): to a task / subtask, delete -->
        <Menu
          :items="itemMenu(i)"
          align="end"
          :label="t('task.checklistItemMenu')"
          data-testid="checklist-menu"
        />
      </li>
    </VueDraggable>
    <form
      :style="{ paddingLeft: `${Math.min(newIndent, newMax) * 1.5}rem` }"
      data-testid="checklist-add"
      @submit.prevent="add"
      @keydown.tab="onTab"
    >
      <Input
        v-model="text"
        :label="t('task.addChecklist')"
        hide-label
        :placeholder="t('task.addChecklist')"
      />
    </form>
  </section>
</template>
