<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  PanelRight,
} from 'lucide-vue-next';
import { updateTask, useScopeTasks, useStatuses, useProject } from '../../tasks';
import type { TaskView } from '../../tasks';
import { Button, IconButton, useBreakpoint } from '../../ui';
import PlanPanel from '../PlanPanel.vue';
import { openTask } from '..';
import type { ViewProps } from '..';
import { useWeekStart } from '../../i18n/week';
import { localToday } from '../filter';
import { useWidenedFilter } from '../scope';
import { useTaskFilter } from '../saved/useFilter';
import { addDays, addMonths, layout, monthDays, parse, range, shift, weekDays } from './dates';

const props = defineProps<ViewProps>();
const { t, locale } = useI18n();
const { isMobile } = useBreakpoint();

const project = useProject(() => props.projectId);
const statuses = useStatuses(() => props.scope?.spaceIds.join(',') ?? project.value?.spaceId ?? '');
const passes = useTaskFilter(
  useWidenedFilter(() => props.filter),
  statuses,
  () => props.options.me,
);
const all = useScopeTasks(() => props.scope?.projectIds ?? [props.projectId]);
const tasks = computed(() =>
  (all.value ?? []).filter((x) => (props.options.showSubtasks || !x.parentId) && passes.value(x)),
);

const storeKey = () => `planar.calendar.${props.projectId}`;
type Mode = 'week' | 'month';
const MODES: Mode[] = ['week', 'month'];
const mode = ref<Mode>('week');
watch(
  () => props.projectId,
  () => {
    try {
      const v = localStorage.getItem(storeKey()) as Mode;
      mode.value = MODES.includes(v) ? v : 'week';
    } catch {
      mode.value = 'week';
    }
  },
  { immediate: true },
);
function setMode(m: Mode) {
  mode.value = m;
  try {
    localStorage.setItem(storeKey(), m);
  } catch {
    // private mode — the mode lives until reload
  }
}

const ws = useWeekStart();
const anchor = ref(localToday());
const today = computed(() => localToday());
const days = computed(() =>
  mode.value === 'week' ? weekDays(anchor.value, ws.value) : monthDays(anchor.value, ws.value),
);
const month = computed(() => parse(anchor.value).getMonth());
const byDay = computed(() => layout(tasks.value, days.value));
const undated = computed(() => tasks.value.filter((x) => !range(x)));

function step(n: number) {
  anchor.value = mode.value === 'week' ? addDays(anchor.value, 7 * n) : addMonths(anchor.value, n);
}
const fmtDate = (d: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale.value, o).format(parse(d));
const weekdayLabel = (d: string) => fmtDate(d, { weekday: 'short' });
// week: days top to bottom (rows); month — weekdays in columns
const vertical = computed(() => mode.value === 'week');
const panel = ref(false);
const drag = ref<{ task: TaskView; from: string | null } | null>(null);
function start(e: DragEvent, task: TaskView, from: string | null) {
  drag.value = { task, from };
  e.dataTransfer?.setData('text/plain', task.id);
}
const fromPanel = (id: string) => {
  const task = undated.value.find((x) => x.id === id);
  if (task) drag.value = { task, from: null };
};
async function drop(to: string) {
  const d = drag.value;
  drag.value = null;
  if (!d) return;
  const patch = shift(d.task, d.from, to);
  if (Object.entries(patch).every(([k, v]) => d.task[k as 'dueDate' | 'startDate'] === v)) return;
  await updateTask(d.task.id, patch);
}

// mobile: a task from the panel is placed by tapping a day
const placing = ref<TaskView | null>(null);
const pick = (id: string) => (placing.value = undated.value.find((x) => x.id === id) ?? null);
function onCell(d: string) {
  const task = placing.value;
  if (!task) return;
  placing.value = null;
  drag.value = { task, from: null };
  void drop(d);
}

// touch: HTML5 drag does not work on phones — the task is moved in the grid with a finger
let touch: { task: TaskView; from: string; x: number; y: number; moved: boolean } | null = null;
function touchDown(e: PointerEvent, task: TaskView, from: string) {
  if (e.pointerType !== 'touch') return;
  touch = { task, from, x: e.clientX, y: e.clientY, moved: false };
  addEventListener('pointermove', touchMove);
  addEventListener('pointerup', touchUp, { once: true });
}
function touchMove(e: PointerEvent) {
  if (touch && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 8) touch.moved = true;
}
function touchUp(e: PointerEvent) {
  removeEventListener('pointermove', touchMove);
  const t = touch;
  touch = null;
  if (!t?.moved) return;
  const day = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-day]')
    ?.dataset.day;
  if (!day) return;
  drag.value = { task: t.task, from: t.from };
  void drop(day);
}
onBeforeUnmount(() => removeEventListener('pointermove', touchMove));
</script>

<template>
  <div class="relative flex h-full flex-col" role="group" :aria-label="t('views.calendar')">
    <div class="flex items-center gap-1 py-1 pl-3 pr-1">
      <IconButton :icon="ChevronLeft" :label="t('calendar.prev')" @click="step(-1)" />
      <input
        type="date"
        :value="anchor"
        :aria-label="t('calendar.period')"
        class="h-9 min-w-0 rounded-md border border-border-strong bg-bg px-2 text-sm md:h-8"
        data-test="period"
        @change="anchor = ($event.target as HTMLInputElement).value || anchor"
      />
      <IconButton :icon="ChevronRight" :label="t('calendar.next')" @click="step(1)" />
      <div role="group" :aria-label="t('plan.mode')" class="ml-1 flex">
        <Button
          v-for="m in MODES"
          :key="m"
          size="sm"
          :variant="mode === m ? 'secondary' : 'ghost'"
          :icon="m === 'month' ? CalendarDays : CalendarRange"
          compact
          :aria-pressed="mode === m"
          :data-test="`mode-${m}`"
          @click="setMode(m)"
          >{{ t(`calendar.${m}`) }}</Button
        >
      </div>
      <IconButton
        v-if="isMobile"
        class="ml-auto"
        :icon="PanelRight"
        :label="t('plan.menu')"
        :active="panel"
        data-test="plan-toggle"
        @click="panel = !panel"
      />
    </div>
    <div
      v-if="placing"
      role="status"
      class="mx-3 mb-2 flex items-center gap-2 rounded-md bg-accent-subtle px-3 py-1 text-sm"
      data-test="placing"
    >
      <span class="min-w-0 flex-1">{{ t('plan.place', { title: placing.title }) }}</span>
      <Button size="sm" variant="ghost" @click="placing = null">{{ t('plan.cancel') }}</Button>
    </div>

    <div class="relative flex min-h-0 flex-1 border-t border-border">
      <!-- месяц на мобилке: ячейки в 1,5 раза шире экранной седьмой — прокрутка вбок -->
      <div
        :class="[
          'grid min-h-0 min-w-0 flex-1 gap-px overflow-auto bg-border',
          vertical
            ? 'grid-flow-col grid-cols-[auto_minmax(0,1fr)] grid-rows-[repeat(7,minmax(3.5rem,1fr))]'
            : isMobile
              ? 'grid-cols-[repeat(7,21.43%)] content-start'
              : 'grid-cols-7 content-start',
        ]"
        data-test="grid"
      >
        <div
          v-for="d in weekDays(anchor, ws)"
          :key="d"
          :class="[
            'bg-bg px-1 text-xs',
            mode === 'week' && d === today ? 'font-bold text-accent' : 'text-fg-muted',
            vertical && 'flex w-12 flex-col items-center justify-center',
          ]"
          data-test="weekday"
        >
          {{ weekdayLabel(d) }}
          <!-- неделя: число — в заголовке дня, не в ячейке -->
          <span v-if="mode === 'week'">{{ parse(d).getDate() }}</span>
        </div>
        <div
          v-for="d in days"
          :key="d"
          :class="[
            'min-w-0 bg-bg p-1',
            vertical && 'flex flex-wrap content-start gap-1',
            isMobile ? !vertical && 'min-h-14' : 'min-h-24',
            mode === 'month' && parse(d).getMonth() !== month && 'opacity-50',
            d === today && 'ring-2 ring-inset ring-accent',
            placing && 'cursor-pointer hover:bg-accent-subtle',
          ]"
          :data-day="d"
          @dragover.prevent
          @drop.prevent="drop(d)"
          @click="onCell(d)"
        >
          <div
            v-if="mode === 'month'"
            class="text-xs"
            :class="d === today && 'font-bold text-accent'"
          >
            {{ parse(d).getDate() }}
          </div>
          <button
            v-for="x in byDay.get(d)"
            :key="x.id"
            type="button"
            draggable="true"
            :class="[
              'block touch-none truncate rounded bg-accent-subtle px-1 text-left',
              vertical ? 'max-w-full py-0.5' : 'mt-0.5 w-full',
              isMobile ? 'text-2xs' : 'text-xs',
            ]"
            :data-task="x.id"
            @dragstart="start($event, x, d)"
            @pointerdown="touchDown($event, x, d)"
            @click.stop="placing ? onCell(d) : openTask(x.key)"
          >
            {{ x.title }}
          </button>
        </div>
      </div>
      <PlanPanel v-model:open="panel" :tasks="undated" @pick="pick" @drag="fromPanel" />
    </div>
  </div>
</template>
