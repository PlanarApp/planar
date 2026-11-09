<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { UserPlus, X } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { mutate, newId, rankBetween } from '../sync';
import { Avatar, Button, IconButton, Input, Menu, type MenuItem } from '../ui';
import { useMembers } from '../tasks';
import { useChecklist } from './queries';

const props = defineProps<{ taskId: string; spaceId: string }>();
const { t } = useI18n();
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
        <span :class="['flex-1', i.done && 'text-fg-subtle line-through']">{{ i.text }}</span>
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
        <Button
          variant="ghost"
          size="sm"
          :icon="X"
          :aria-label="t('task.delete')"
          @click="mutate('checklist.delete', { id: i.id })"
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
