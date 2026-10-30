<script setup lang="ts">
import { ListTree } from 'lucide-vue-next';
import type { Row as DbRow } from '@planar/shared';
import { StatusPicker, updateTask, type TaskView } from '../../tasks';
import { BlockedIcon } from '../../links';
import { useBreakpoint } from '../../ui';
import CardField, { type CardCol } from '../board/CardField.vue';

// Карточка задачи (Доска; Список на мобилке): статус-кнопка и название, ниже поля-кнопки.
// Мобильная — поля только иконками.
defineProps<{
  task: TaskView;
  spaceId: string;
  /** поля карточки по порядку (отбор заполненных — у вызывающего) */
  cols: CardCol[];
  blocked: boolean;
  members: DbRow<'users'>[];
  labels: DbRow<'labels'>[];
  /** пикеры полей смонтированы (карточка под курсором; на мобилке — всегда) */
  hot: boolean;
  parentTitle?: string;
  childCount?: number;
  projectName?: string;
  /** название в одну строку (строка Списка фиксированной высоты) */
  oneLine?: boolean;
  depth?: number;
}>();
const { isMobile } = useBreakpoint();
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
        :model-value="task.statusId"
        @update:model-value="updateTask(task.id, { statusId: $event })"
      />
    </div>
    <BlockedIcon v-if="blocked" class="mt-1.5" />
    <p
      role="gridcell"
      :class="[
        'min-w-0 flex-1 pt-1 text-sm leading-snug text-fg',
        oneLine ? 'truncate font-medium' : 'line-clamp-3',
      ]"
    >
      {{ task.title }}
    </p>
    <span
      v-if="childCount"
      class="mt-1 inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs text-fg-muted"
      data-testid="row-children"
      ><ListTree :size="12" />{{ childCount }}</span
    >
  </div>
  <div v-if="cols.length" class="-mx-1.5 flex flex-wrap items-center">
    <CardField
      v-for="c in cols"
      :key="c"
      :col="c"
      :task="task"
      :space-id="spaceId"
      :members="members"
      :labels="labels"
      :hot="hot"
      :project-name="projectName"
      :icon-only="isMobile"
    />
  </div>
</template>
