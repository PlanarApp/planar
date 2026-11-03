<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarDays, Flag, FolderKanban, Tag, UserRound } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import {
  AssigneePicker,
  DueDatePicker,
  LabelPicker,
  PriorityIcon,
  PriorityPicker,
  setAssignees,
  setLabels,
  updateTask,
  type TaskView,
} from '../../tasks';
import { AvatarStack, Badge } from '../../ui';
import { formatDue } from '../list/due';
import { localToday } from '../filter';

export type CardCol = 'project' | 'priority' | 'dueDate' | 'assignee' | 'labels';
// card field: at rest — the value; while the card is under the cursor — a picker with the same content (click — choose)
const props = defineProps<{
  col: CardCol;
  task: TaskView;
  spaceId: string;
  members: Row<'users'>[];
  labels: Row<'labels'>[];
  hot: boolean;
  /** the task's project name — the "Project" field */
  projectName?: string;
  /** mobile: icons only (the text — in the hint) */
  iconOnly?: boolean;
}>();
const { t, locale } = useI18n();
const people = computed(() =>
  props.task.assigneeIds.map((id) => ({
    name: props.members.find((u) => u.id === id)?.name ?? '?',
  })),
);
const chosen = computed(() =>
  props.task.labelIds.flatMap((id) => props.labels.find((l) => l.id === id) ?? []),
);
const box = 'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-sm text-fg';
const due = computed(() => (props.task.dueDate ? formatDue(props.task.dueDate, locale.value) : ''));
// overdue — danger (an icon without text must show this)
const dueTone = computed(() =>
  props.task.dueDate && props.task.dueDate < localToday() ? 'text-danger' : 'text-fg-muted',
);
const empty = 'text-fg-subtle opacity-60';
</script>

<template>
  <span data-no-drag class="contents" @click.stop>
    <span v-if="col === 'project'" :class="[box, 'text-fg-muted']" :title="projectName">
      <FolderKanban v-if="iconOnly" :size="14" aria-hidden="true" />
      <span v-else class="truncate">{{ projectName }}</span>
    </span>
    <template v-else-if="hot">
      <PriorityPicker
        v-if="col === 'priority'"
        :model-value="task.priority"
        @update:model-value="updateTask(task.id, { priority: $event })"
        ><template #value>
          <PriorityIcon v-if="task.priority" :priority="task.priority" />
          <Flag v-else :size="14" :class="empty" /></template
      ></PriorityPicker>
      <DueDatePicker
        v-else-if="col === 'dueDate'"
        :model-value="task.dueDate"
        @update:model-value="updateTask(task.id, { dueDate: $event })"
        ><template #value>
          <CalendarDays v-if="task.dueDate && iconOnly" :size="14" :class="dueTone" />
          <span v-else-if="task.dueDate" :class="dueTone">{{ due }}</span>
          <CalendarDays v-else :size="14" :class="empty" /></template
      ></DueDatePicker>
      <AssigneePicker
        v-else-if="col === 'assignee'"
        :space-id="spaceId"
        :model-value="task.assigneeIds"
        @update:model-value="setAssignees(task.id, $event)"
        ><template #value>
          <AvatarStack v-if="people.length" :people="people" size="xs" />
          <UserRound v-else :size="14" :class="empty" /></template
      ></AssigneePicker>
      <LabelPicker
        v-else
        :space-id="spaceId"
        :project-id="task.projectId"
        :model-value="task.labelIds"
        @update:model-value="setLabels(task.id, $event)"
        ><template #value>
          <span
            v-for="l in iconOnly ? chosen : []"
            :key="l.id"
            class="size-2 shrink-0 rounded-full bg-fg-subtle"
            :style="l.color ? { background: l.color } : undefined" />
          <Badge
            v-for="l in iconOnly ? [] : chosen"
            :key="l.id"
            dot
            :color="l.color ?? undefined"
            >{{ l.name }}</Badge
          >
          <Tag v-if="!chosen.length" :size="14" :class="empty" /></template
      ></LabelPicker>
    </template>
    <span
      v-else
      :class="box"
      :title="
        col === 'assignee'
          ? people.map((p) => p.name).join(', ')
          : col === 'dueDate'
            ? due
            : col === 'labels'
              ? chosen.map((l) => l.name).join(', ')
              : undefined
      "
    >
      <template v-if="col === 'priority'">
        <PriorityIcon v-if="task.priority" :priority="task.priority" />
        <Flag v-else :size="14" :class="empty" />
      </template>
      <template v-else-if="col === 'dueDate'">
        <CalendarDays v-if="task.dueDate && iconOnly" :size="14" :class="dueTone" />
        <span v-else-if="task.dueDate" :class="dueTone">{{ due }}</span>
        <CalendarDays v-else :size="14" :class="empty" />
      </template>
      <template v-else-if="col === 'assignee'">
        <AvatarStack v-if="people.length" :people="people" size="xs" />
        <UserRound v-else :size="14" :class="empty" />
      </template>
      <template v-else>
        <span
          v-for="l in iconOnly ? chosen : []"
          :key="l.id"
          class="size-2 shrink-0 rounded-full bg-fg-subtle"
          :style="l.color ? { background: l.color } : undefined"
        />
        <Badge v-for="l in iconOnly ? [] : chosen" :key="l.id" dot :color="l.color ?? undefined">{{
          l.name
        }}</Badge>
        <Tag v-if="!chosen.length" :size="14" :class="empty" />
      </template>
    </span>
  </span>
</template>
