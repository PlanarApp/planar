<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AssigneePicker,
  DueDatePicker,
  PriorityPicker,
  PriorityIcon,
  LabelPicker,
  StatusPicker,
  setAssignees,
  setLabels,
  updateTask,
  type TaskView,
} from '../../tasks';
import type { Row as DbRow } from '@planar/shared';
import { AvatarStack, Badge } from '../../ui';
import { ChevronDown, ChevronRight, GripVertical, ListTree } from 'lucide-vue-next';
import { COLUMN_CLASS, visibleColumns } from './columns';
import { BlockedIcon } from '../../links';
import type { TaskField } from '../options';
import { localToday } from '../filter';
import { formatDue } from './due';

const props = defineProps<{
  task: TaskView;
  spaceId: string;
  index: number;
  selected: boolean;
  focused: boolean;
  editing: boolean;
  fields: TaskField[];
  blocked: boolean;
  members: DbRow<'users'>[];
  labels: DbRow<'labels'>[];
  /** уровень вложенности подзадачи (0 — верхний) */
  depth?: number;
  /** родитель не показан над строкой (другая группа, подзадачи скрыты) — подпись в строке */
  parentTitle?: string;
  /** ручка перетаскивания (сортировка «Вручную») */
  draggable?: boolean;
  /** число подзадач в виде; > 0 — шеврон сворачивания и счётчик */
  childCount?: number;
  /** подзадачи свёрнуты */
  folded?: boolean;
}>();
const emit = defineEmits<{
  click: [e: MouseEvent];
  drag: [e: PointerEvent];
  fold: [];
  toggle: [];
  edit: [];
  done: [];
}>();
const { t, locale } = useI18n();
// пикеры справа видны только при наведении/фокусе — до этого не монтируем (переключение проекта)
const hot = ref(false);
const input = ref<HTMLInputElement>();
const draft = ref('');
let live = false; // blur после Enter/Esc не сохраняет повторно

watch(
  () => props.editing,
  async (e) => {
    live = e;
    if (!e) return;
    draft.value = props.task.title;
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
  { immediate: true },
);

const columns = computed(() => visibleColumns(props.fields));
const labelsSet = computed(() =>
  props.task.labelIds.flatMap((id) => props.labels.find((l) => l.id === id) ?? []),
);
const people = computed(() =>
  props.task.assigneeIds.map((id) => ({
    name: props.members.find((u) => u.id === id)?.name ?? '?',
  })),
);
// просрочен (раньше локального сегодня) — danger, сегодня и завтра — warning
const dueTone = computed(() => {
  const d = props.task.dueDate;
  if (!d) return '';
  const today = localToday();
  const next = new Date();
  next.setDate(next.getDate() + 1);
  const tomorrow = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  return d < today ? 'text-danger' : d <= tomorrow ? 'text-warning' : 'text-fg-muted';
});

function save() {
  if (!live) return;
  live = false;
  const title = draft.value.trim();
  emit('done'); // сначала выходим из режима правки: blur при размонтировании не сохранит повторно
  if (title && title !== props.task.title) void updateTask(props.task.id, { title });
}
</script>

<template>
  <div
    role="row"
    :aria-rowindex="index"
    :aria-selected="selected"
    :data-task="task.key"
    :class="[
      'group relative flex h-full items-center gap-2 border-b border-border px-3 text-sm',
      selected ? 'bg-accent-subtle' : 'hover:bg-bg-subtle',
      focused ? 'ring-2 ring-inset ring-focus' : '',
    ]"
    @click="emit('click', $event)"
    @pointerenter="hot = true"
    @focusin="hot = true"
  >
    <div
      v-if="draggable"
      class="-ml-2 flex w-4 shrink-0 cursor-grab items-center justify-center text-fg-subtle opacity-0 group-hover:opacity-100 touch-none"
      data-testid="row-grip"
      :aria-label="t('list.drag')"
      @pointerdown.stop.prevent="emit('drag', $event)"
      @click.stop
    >
      <GripVertical :size="14" />
    </div>
    <div role="gridcell" class="w-5 shrink-0" @click.stop>
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="t('list.select')"
        :class="[
          'size-4 focus-visible:opacity-100 group-hover:opacity-100',
          selected ? 'opacity-100' : 'opacity-0',
        ]"
        @change="(emit('toggle'), emit('done'))"
      />
    </div>
    <span v-if="depth" class="shrink-0" :style="{ width: `${depth * 20}px` }" aria-hidden="true" />
    <button
      v-if="childCount"
      type="button"
      class="-mx-1 flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
      :aria-expanded="!folded"
      :aria-label="t(folded ? 'list.expand' : 'list.collapse')"
      data-testid="row-fold"
      @click.stop="emit('fold')"
    >
      <component :is="folded ? ChevronRight : ChevronDown" :size="14" />
    </button>
    <span v-else-if="childCount !== undefined" class="w-3 shrink-0" aria-hidden="true" />
    <div role="gridcell" class="w-16 shrink-0 truncate font-mono text-xs text-fg-muted">
      {{ task.key }}
    </div>
    <div v-if="fields.includes('status')" role="gridcell" class="shrink-0" @click.stop>
      <StatusPicker
        compact
        :space-id="spaceId"
        :model-value="task.statusId"
        @update:model-value="updateTask(task.id, { statusId: $event })"
      />
    </div>
    <div role="gridcell" class="min-w-0 flex-1" @dblclick.stop="emit('edit')">
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        :aria-label="t('list.editTitle')"
        class="h-7 w-full rounded-md border border-border-strong bg-bg px-2 text-sm outline-none focus-visible:ring-2 ring-focus"
        @click.stop
        @keydown.enter.prevent="save"
        @keydown.esc.stop.prevent="((live = false), emit('done'))"
        @blur="save"
      />
      <span v-else class="flex items-center gap-1">
        <BlockedIcon v-if="blocked" />
        <span
          v-if="parentTitle"
          class="max-w-48 shrink-0 truncate text-xs text-fg-subtle"
          data-testid="row-parent"
          >{{ parentTitle }} ›</span
        >
        <span class="truncate">{{ task.title }}</span>
        <span
          v-if="childCount"
          class="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs text-fg-muted"
          data-testid="row-children"
          ><ListTree :size="12" />{{ childCount }}</span
        >
      </span>
    </div>
    <!-- колонки как в ClickUp: значение в ячейке; при наведении ячейка — сам пикер (монтируется лениво) -->
    <div class="ml-auto flex shrink-0 items-center" @click.stop>
      <div
        v-for="c in columns"
        :key="c"
        role="gridcell"
        :data-col="c"
        :class="['flex h-full min-w-0 items-center overflow-hidden px-1', COLUMN_CLASS[c]]"
      >
        <template v-if="c === 'assignee'">
          <AssigneePicker
            v-if="hot || focused"
            :space-id="spaceId"
            :model-value="task.assigneeIds"
            @update:model-value="setAssignees(task.id, $event)"
          />
          <AvatarStack v-else-if="people.length" :people="people" size="xs" />
        </template>
        <template v-else-if="c === 'dueDate'">
          <DueDatePicker
            v-if="hot || focused"
            :model-value="task.dueDate"
            @update:model-value="updateTask(task.id, { dueDate: $event })"
          />
          <span v-else-if="task.dueDate" :class="['px-1.5 text-sm', dueTone]">{{
            formatDue(task.dueDate, locale)
          }}</span>
        </template>
        <template v-else-if="c === 'priority'">
          <PriorityPicker
            v-if="hot || focused"
            :model-value="task.priority"
            @update:model-value="updateTask(task.id, { priority: $event })"
          />
          <span v-else-if="task.priority" class="flex items-center gap-1.5 px-1.5 text-sm">
            <PriorityIcon :priority="task.priority" />{{ t(`tasks.priority.${task.priority}`) }}
          </span>
        </template>
        <template v-else>
          <LabelPicker
            v-if="hot || focused"
            :space-id="spaceId"
            :model-value="task.labelIds"
            @update:model-value="setLabels(task.id, $event)"
          />
          <span v-else class="flex gap-1 overflow-hidden px-1">
            <Badge v-for="l in labelsSet" :key="l.id" dot :color="l.color ?? undefined">{{
              l.name
            }}</Badge>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>
