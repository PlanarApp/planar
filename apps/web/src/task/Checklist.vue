<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CornerDownRight, SquarePlus, Trash2, UserPlus } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { db, mutate, newId, rankBetween, useQuery } from '../sync';
import { Avatar, IconButton, Input, Menu, type MenuItem } from '../ui';
import { createTask, useMembers } from '../tasks';
import { useChecklist } from './queries';

const props = defineProps<{
  taskId: string;
  spaceId: string;
  projectId: string;
  statuses: Row<'statuses'>[];
}>();
const emit = defineEmits<{ open: [key: string] }>();
const { t } = useI18n();
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
// an item is assigned as a comment (PLNRAPP-140): the menu of space members with avatars
const members = useMembers(() => props.spaceId);
const avatarOf = (u: Row<'users'> | undefined) =>
  u?.avatarFile ? `/files/${u.avatarFile}/preview?w=256` : null;
const userOf = (id: string | null | undefined) => members.value?.find((u) => u.id === id);
const assignItems = (i: Row<'checklistItems'>): MenuItem[] => [
  ...(members.value ?? []).map((u) => ({
    id: u.id,
    label: u.name,
    icon: Avatar,
    iconProps: { name: u.name, src: avatarOf(u), size: 'xs' },
    onSelect: () => void mutate('checklist.update', { id: i.id, assigneeId: u.id }),
  })),
  ...(i.assigneeId
    ? [
        { separator: true as const },
        {
          id: 'none',
          label: t('task.unassignComment'),
          onSelect: () => void mutate('checklist.update', { id: i.id, assigneeId: null }),
        },
      ]
    : []),
];

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
  });
}
</script>

<template>
  <section :aria-label="t('task.checklist')">
    <!-- the title and done/total are on the tab (PLNRAPP-100, -102) -->
    <ul>
      <li
        v-for="i in items"
        :key="i.id"
        class="group flex min-h-11 items-center gap-2 md:min-h-8"
        data-testid="checklist-item"
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
        <Menu v-if="members?.length" :items="assignItems(i)" align="end">
          <template #trigger>
            <button
              v-if="i.assigneeId"
              type="button"
              class="inline-flex items-center rounded-md p-1 hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
              :aria-label="t('task.assignedTo', { name: userOf(i.assigneeId)?.name ?? '?' })"
              :title="userOf(i.assigneeId)?.name"
              data-testid="checklist-assignee"
            >
              <Avatar
                :name="userOf(i.assigneeId)?.name ?? '?'"
                :src="avatarOf(userOf(i.assigneeId))"
                size="sm"
              />
            </button>
            <IconButton
              v-else
              size="sm"
              :icon="UserPlus"
              :label="t('task.assignComment')"
              class="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
              data-testid="checklist-assign"
            />
          </template>
        </Menu>
        <!-- «…» instead of the delete cross (PLNRAPP-142): to a task / subtask, delete -->
        <Menu
          :items="itemMenu(i)"
          align="end"
          :label="t('task.checklistItemMenu')"
          data-testid="checklist-menu"
        />
      </li>
    </ul>
    <form @submit.prevent="add">
      <Input
        v-model="text"
        :label="t('task.addChecklist')"
        hide-label
        :placeholder="t('task.addChecklist')"
      />
    </form>
  </section>
</template>
