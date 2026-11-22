<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row as DbRow } from '@planar/shared';
import { CornerDownRight } from 'lucide-vue-next';
import { StatusIcon, StatusPicker, updateTask, useStatuses, type TaskView } from '../../tasks';
import { BlockedIcon } from '../../links';
import { useBreakpoint } from '../../ui';
import { toast } from '../../ui/toast';
import CardField, { type CardCol } from '../board/CardField.vue';
import { useCardExtensions } from '../cardExtensions';
import { openTask } from '../open';
import TaskAiStatus from '../TaskAiStatus.vue';
import TaskProgress from '../TaskProgress.vue';

// task card (Board, Cards, List on mobile): the parent line, the key with the badges block on the right,
// status (AI icon under it) and the name, the field buttons below. Mobile — fields as icons only.
// `head` (the mobile List): status · key · AI and badges in one line, the name under it.
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
  /** the parent is not shown above the card — its line, the click opens it */
  parent?: { key: string; title: string; statusId?: string; projectId?: string };
  projectName?: string;
  /** "Project" field as the name even on mobile (the List card); the Board keeps the folder icon */
  projectText?: boolean;
  /** name on one line (a List row of fixed height) */
  oneLine?: boolean;
  /** the whole name, wrapped by words (the "Wrap task names" option); otherwise up to 3 lines */
  wrap?: boolean;
  depth?: number;
  /** the mobile List: status and the AI icon in the key line, the badges pressed to the key */
  head?: boolean;
  /** tag names instead of tag icons (the "Show tag names" option) */
  labelNames?: boolean;
}>();
const { t } = useI18n();
const { isMobile } = useBreakpoint();
const ext = useCardExtensions(() => props.task.projectId);
const badges = computed(() => ext.value.filter((x) => x.badge));
const fields = computed(() => ext.value.filter((x) => !x.badge));
// the parent's status in the mobile parent line
const parentStatuses = useStatuses(
  () => props.spaceId,
  () => props.parent?.projectId,
);
const parentStatus = computed(() =>
  props.head ? parentStatuses.value?.find((x) => x.id === props.parent?.statusId) : undefined,
);
// click on the key — copy it (PLNRAPP-181)
const copyKey = () =>
  void navigator.clipboard
    ?.writeText(props.task.key)
    .then(() => toast(t('taskMenu.idCopied'), 2500));
</script>

<template>
  <button
    v-if="parent"
    type="button"
    data-no-drag
    class="flex min-w-0 max-w-full items-center gap-1 self-start text-left text-xs text-fg-subtle outline-none hover:underline focus-visible:ring-2 ring-focus"
    data-testid="card-parent"
    @click.stop="openTask(parent.key)"
  >
    <template v-if="head"
      ><CornerDownRight :size="12" class="shrink-0" aria-hidden="true" /><StatusIcon
        v-if="parentStatus"
        :status="parentStatus"
        class="shrink-0"
      /><span class="shrink-0">{{ parent.key }}</span></template
    ><span v-else class="shrink-0">↳ {{ parent.key }}</span
    ><span class="truncate">{{ parent.title }}</span>
  </button>
  <div class="flex min-w-0 items-center gap-1">
    <span v-if="depth" class="shrink-0" :style="{ width: `${depth * 12}px` }" aria-hidden="true" />
    <div v-if="head" data-no-drag role="gridcell" class="-ml-1.5 shrink-0" @click.stop>
      <StatusPicker
        compact
        :space-id="spaceId"
        :project-id="task.projectId"
        :model-value="task.statusId"
        @update:model-value="updateTask(task.id, { statusId: $event })"
      />
    </div>
    <button
      type="button"
      data-no-drag
      class="shrink-0 cursor-copy text-xs text-fg-subtle underline-offset-2 outline-none hover:underline focus-visible:ring-2 ring-focus"
      :title="t('task.copyKey')"
      data-testid="card-key"
      @click.stop="copyKey"
    >
      {{ task.key }}
    </button>
    <!-- PLNRAPP-333/577: subtasks, assigned comments, checklist; module badges (branches/MR/CI) -->
    <span
      :class="[
        'flex min-w-0 flex-wrap items-center',
        head ? 'ml-2 gap-1' : 'ml-auto justify-end gap-0.5',
      ]"
      data-testid="card-badges"
      ><TaskAiStatus
        v-if="head"
        :task="task"
        data-no-drag
        data-testid="card-ai"
        @click.stop /><TaskProgress :task-id="task.id" :comments="task" /><span
        v-for="x in badges"
        :key="x.key"
        data-no-drag
        class="inline-flex"
        @click.stop
        ><component :is="x.view" :task-id="task.id" /></span
    ></span>
  </div>
  <div class="flex min-w-0 items-start gap-0.5">
    <span v-if="depth" class="shrink-0" :style="{ width: `${depth * 12}px` }" aria-hidden="true" />
    <!-- -ml-1.5: иконка статуса вровень с полями ниже (у кнопок пикеров свой отступ); под ней — ИИ (PLNRAPP-401) -->
    <div v-if="!head" class="-ml-1.5 flex shrink-0 flex-col items-center">
      <div data-no-drag role="gridcell" @click.stop>
        <StatusPicker
          compact
          :space-id="spaceId"
          :project-id="task.projectId"
          :model-value="task.statusId"
          @update:model-value="updateTask(task.id, { statusId: $event })"
        />
      </div>
      <TaskAiStatus :task="task" data-no-drag data-testid="card-ai" @click.stop />
    </div>
    <BlockedIcon v-if="blocked" class="mt-1.5" />
    <p
      role="gridcell"
      :class="[
        'min-w-0 flex-1 pt-1 text-sm leading-snug text-fg',
        oneLine ? 'truncate font-medium' : wrap ? 'break-words' : 'line-clamp-3',
      ]"
    >
      {{ task.title }}
    </p>
  </div>
  <div v-if="cols.length || fields.length" class="-mx-1.5 flex flex-wrap items-center">
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
        :label-names="labelNames"
      />
    </template>
    <!-- поля модулей (время): видны всегда, если модуль включён -->
    <span v-for="x in fields" :key="x.key" data-no-drag class="inline-flex px-1.5">
      <component :is="x.view" :task-id="task.id" />
    </span>
  </div>
</template>
