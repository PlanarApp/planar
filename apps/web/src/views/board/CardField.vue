<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarDays, Flag, FolderKanban, Tag, UserRound } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import {
  AssigneePicker,
  LabelPicker,
  PriorityIcon,
  PriorityPicker,
  setAssignees,
  setLabels,
  TaskDatesPicker,
  updateTask,
  type TaskView,
} from '../../tasks';
import { AvatarStack, Badge } from '../../ui';
import { dateTone, formatDue } from '../list/due';
import DatesValue from '../../tasks/fields/DatesValue.vue';

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
  /** tag names even with iconOnly (the "Show tag names" option) */
  labelNames?: boolean;
  /** PLNRAPP-802: the mobile List — a tag icon (12 px, the tag's color) before the name instead of the dot */
  tagIcon?: boolean;
  /** the List card on desktop: the value frame of the dense picker buttons (24 px, 2 px sides) */
  dense?: boolean;
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
const box = computed(() =>
  [
    'inline-flex max-w-full items-center gap-1.5 rounded-md text-sm text-fg',
    props.dense ? 'h-6 px-0.5' : 'h-7 px-1.5',
  ].join(' '),
);
const due = computed(() =>
  [props.task.startDate, props.task.dueDate]
    .filter((d): d is string => !!d)
    .map((d) => formatDue(d, locale.value))
    .join(' – '),
);
// the icon without text shows the due date's color (only a start — the start's)
const dueTone = computed(() => {
  const d = props.task.dueDate ?? props.task.startDate;
  return d ? dateTone(d) : '';
});
const empty = 'text-fg-subtle opacity-60';
// mobile: a tag icon in the tag's color per tag, unless the names are asked for
// the List card (tagIcon): tag icons too, names with the "Show tag names" option
const tagIcons = computed(() => (props.iconOnly || props.tagIcon) && !props.labelNames);
// PLNRAPP-802: a tag with the icon — as Badge dot (h-5 text-xs), the gap to the name 2 px
const tagChip = 'inline-flex h-5 items-center gap-0.5 text-xs font-medium text-fg-muted';
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
      <TaskDatesPicker
        v-else-if="col === 'dueDate'"
        :task-id="task.id"
        :start="task.startDate"
        :due="task.dueDate"
        @update:start="(v: string | null) => updateTask(task.id, { startDate: v })"
        @update:due="(v: string | null) => updateTask(task.id, { dueDate: v })"
        ><template #value>
          <CalendarDays v-if="due && iconOnly" :size="14" :class="dueTone" />
          <DatesValue v-else-if="due" :start="task.startDate" :due="task.dueDate" />
          <CalendarDays v-else :size="14" :class="empty" /></template
      ></TaskDatesPicker>
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
          <Tag
            v-for="l in tagIcons ? chosen : []"
            :key="l.id"
            :size="14"
            class="shrink-0 text-fg-subtle"
            :style="l.color ? { color: l.color } : undefined" />
          <template v-if="!tagIcons && tagIcon"
            ><span v-for="l in chosen" :key="l.id" :class="tagChip" data-testid="card-tag"
              ><Tag
                :size="12"
                class="shrink-0 text-fg-muted"
                aria-hidden="true"
                :style="l.color ? { color: l.color } : undefined"
              />{{ l.name }}</span
            ></template
          >
          <Badge
            v-for="l in tagIcons || tagIcon ? [] : chosen"
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
        <CalendarDays v-if="due && iconOnly" :size="14" :class="dueTone" />
        <DatesValue v-else-if="due" :start="task.startDate" :due="task.dueDate" />
        <CalendarDays v-else :size="14" :class="empty" />
      </template>
      <template v-else-if="col === 'assignee'">
        <AvatarStack v-if="people.length" :people="people" size="xs" />
        <UserRound v-else :size="14" :class="empty" />
      </template>
      <template v-else>
        <Tag
          v-for="l in tagIcons ? chosen : []"
          :key="l.id"
          :size="14"
          class="shrink-0 text-fg-subtle"
          :style="l.color ? { color: l.color } : undefined"
        />
        <template v-if="!tagIcons && tagIcon"
          ><span v-for="l in chosen" :key="l.id" :class="tagChip" data-testid="card-tag"
            ><Tag
              :size="12"
              class="shrink-0 text-fg-muted"
              aria-hidden="true"
              :style="l.color ? { color: l.color } : undefined"
            />{{ l.name }}</span
          ></template
        >
        <Badge
          v-for="l in tagIcons || tagIcon ? [] : chosen"
          :key="l.id"
          dot
          :color="l.color ?? undefined"
          >{{ l.name }}</Badge
        >
        <Tag v-if="!chosen.length" :size="14" :class="empty" />
      </template>
    </span>
  </span>
</template>
