<script setup lang="ts">
import { ListTree } from 'lucide-vue-next';
import type { Row as DbRow } from '@planar/shared';
import { StatusPicker, updateTask, type TaskView } from '../../tasks';
import { BlockedIcon } from '../../links';
import { useBreakpoint } from '../../ui';
import CardField, { type CardCol } from '../board/CardField.vue';
import { useCardExtensions } from '../cardExtensions';

// task card (Board; List on mobile): status button and name, the field buttons below.
// Mobile — fields as icons only.
const props = defineProps<{
  task: TaskView;
  spaceId: string;
  /** card fields in order (selecting the filled ones — by the caller) */
  cols: CardCol[];
  blocked: boolean;
  members: DbRow<'users'>[];
  labels: DbRow<'labels'>[];
  /** field pickers are mounted (card under the cursor; on mobile — always) */
  hot: boolean;
  parentTitle?: string;
  childCount?: number;
  projectName?: string;
  /** "Project" field as the name even on mobile (the List card); the Board keeps the folder icon */
  projectText?: boolean;
  /** name on one line (a List row of fixed height) */
  oneLine?: boolean;
  /** the whole name, wrapped by words (the "Wrap task names" option); otherwise up to 3 lines */
  wrap?: boolean;
  depth?: number;
  /** the task key before the name */
  showKey?: boolean;
}>();
const { isMobile } = useBreakpoint();
const ext = useCardExtensions(() => props.task.projectId);
</script>

<template>
  <span v-if="parentTitle" class="truncate text-xs text-fg-subtle" data-testid="card-parent"
    >↳ {{ parentTitle }}</span
  >
  <div class="flex min-w-0 items-start gap-0.5">
    <span v-if="depth" class="shrink-0" :style="{ width: `${depth * 12}px` }" aria-hidden="true" />
    <!-- -ml-1.5: иконка статуса вровень с полями ниже (у кнопок пикеров свой отступ) -->
    <div data-no-drag role="gridcell" class="-ml-1.5 shrink-0" @click.stop>
      <StatusPicker
        compact
        :space-id="spaceId"
        :project-id="task.projectId"
        :model-value="task.statusId"
        @update:model-value="updateTask(task.id, { statusId: $event })"
      />
    </div>
    <BlockedIcon v-if="blocked" class="mt-1.5" />
    <p
      role="gridcell"
      :class="[
        'min-w-0 flex-1 pt-1 text-sm leading-snug text-fg',
        oneLine ? 'truncate font-medium' : wrap ? 'break-words' : 'line-clamp-3',
      ]"
    >
      <span v-if="showKey" class="mr-1 text-xs font-normal text-fg-subtle" data-testid="card-key">{{
        task.key
      }}</span
      >{{ task.title }}
    </p>
    <span
      v-if="childCount"
      class="mt-1 inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs text-fg-muted"
      data-testid="row-children"
      ><ListTree :size="12" />{{ childCount }}</span
    >
  </div>
  <div v-if="cols.length || ext.length" class="-mx-1.5 flex flex-wrap items-center">
    <template v-for="c in cols" :key="c">
      <span
        v-if="projectText && c === 'project'"
        class="inline-flex h-7 min-w-0 max-w-full items-center px-1.5 text-sm text-fg-muted"
        data-testid="card-project"
        :title="projectName"
        ><span class="truncate">{{ projectName }}</span></span
      >
      <CardField
        v-else
        :col="c"
        :task="task"
        :space-id="spaceId"
        :members="members"
        :labels="labels"
        :hot="hot"
        :project-name="projectName"
        :icon-only="isMobile"
      />
    </template>
    <!-- поля модулей (время): видны всегда, если модуль включён -->
    <span v-for="x in ext" :key="x.key" data-no-drag class="inline-flex px-1.5">
      <component :is="x.view" :task-id="task.id" />
    </span>
  </div>
</template>
