<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { updateTask, useProjectTasks, useStatuses, useProject } from '../../tasks';
import type { TaskView } from '../../tasks';
import { useBreakpoint } from '../../ui';
import { openTask } from '..';
import type { ViewProps } from '..';
import { useWeekStart } from '../../i18n/week';
import { localToday } from '../filter';
import { useTaskFilter } from '../saved/useFilter';
import { addDays, addMonths, layout, monthDays, parse, range, shift, weekDays } from './dates';

const props = defineProps<ViewProps>();
const { t, locale } = useI18n();
const { isMobile } = useBreakpoint();

const project = useProject(() => props.projectId);
const statuses = useStatuses(() => project.value?.spaceId ?? '');
const passes = useTaskFilter(() => props.filter, statuses, () => props.options.me);
const all = useProjectTasks(() => props.projectId);
const tasks = computed(() =>
  (all.value ?? []).filter((x) => (props.options.showSubtasks || !x.parentId) && passes.value(x)),
);

const storeKey = () => `planar.calendar.${props.projectId}`;
const mode = ref<'month' | 'week'>('month');
watch(
  () => props.projectId,
  () => {
    try {
      mode.value = localStorage.getItem(storeKey()) === 'week' ? 'week' : 'month';
    } catch {
      mode.value = 'month';
    }
  },
  { immediate: true },
);
function setMode(m: 'month' | 'week') {
  mode.value = m;
  try {
    localStorage.setItem(storeKey(), m);
  } catch {
    // приватный режим — режим живёт до перезагрузки
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
// mobile: список по дням текущего месяца, только дни с задачами
const mobileDays = computed(() => {
  const m = monthDays(anchor.value, ws.value).filter((d) => parse(d).getMonth() === month.value);
  return [...layout(tasks.value, m)].filter(([, l]) => l.length);
});

function step(n: number) {
  anchor.value =
    mode.value === 'week' && !isMobile.value
      ? addDays(anchor.value, 7 * n)
      : addMonths(anchor.value, n);
}
const title = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(
    parse(anchor.value),
  ),
);
const dayLabel = (d: string) =>
  new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(parse(d));
const weekdayLabel = (d: string) =>
  new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(parse(d));

const drag = ref<{ task: TaskView; from: string | null } | null>(null);
function start(e: DragEvent, task: TaskView, from: string | null) {
  drag.value = { task, from };
  e.dataTransfer?.setData('text/plain', task.id);
}
async function drop(to: string) {
  const d = drag.value;
  drag.value = null;
  if (!d) return;
  const patch = shift(d.task, d.from, to);
  if (Object.entries(patch).every(([k, v]) => d.task[k as 'dueDate' | 'startDate'] === v)) return;
  await updateTask(d.task.id, patch);
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 p-3" role="group" :aria-label="t('views.calendar')">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded border px-2 py-1"
        :aria-label="t('calendar.prev')"
        @click="step(-1)"
      >
        ‹
      </button>
      <button type="button" class="rounded border px-2 py-1" @click="anchor = localToday()">
        {{ t('calendar.today') }}
      </button>
      <button
        type="button"
        class="rounded border px-2 py-1"
        :aria-label="t('calendar.next')"
        @click="step(1)"
      >
        ›
      </button>
      <h2 class="mx-2 font-medium capitalize" data-test="title">{{ title }}</h2>
      <div v-if="!isMobile" class="ml-auto flex gap-1">
        <button
          v-for="m in ['month', 'week'] as const"
          :key="m"
          type="button"
          class="rounded border px-2 py-1"
          :class="mode === m && 'bg-black/10 font-medium'"
          :aria-pressed="mode === m"
          :data-test="`mode-${m}`"
          @click="setMode(m)"
        >
          {{ t(`calendar.${m}`) }}
        </button>
      </div>
    </div>

    <div v-if="isMobile" class="flex-1 overflow-y-auto" data-test="agenda">
      <p v-if="!mobileDays.length" class="p-3 opacity-60">{{ t('calendar.empty') }}</p>
      <section v-for="[d, list] in mobileDays" :key="d" class="mb-3">
        <h3 class="text-sm font-medium" :class="d === today && 'text-blue-600'">
          {{ dayLabel(d) }}
        </h3>
        <button
          v-for="x in list"
          :key="x.id"
          type="button"
          class="block w-full truncate rounded px-2 py-2 text-left hover:bg-black/5"
          @click="openTask(x.key)"
        >
          <span class="opacity-60">{{ x.key }}</span> {{ x.title }}
        </button>
      </section>
      <section v-if="undated.length">
        <h3 class="text-sm font-medium">{{ t('calendar.undated') }}</h3>
        <button
          v-for="x in undated"
          :key="x.id"
          type="button"
          class="block w-full truncate rounded px-2 py-2 text-left hover:bg-black/5"
          @click="openTask(x.key)"
        >
          <span class="opacity-60">{{ x.key }}</span> {{ x.title }}
        </button>
      </section>
    </div>

    <div v-else class="flex min-h-0 flex-1 gap-3">
      <div
        class="grid min-w-0 flex-1 grid-cols-7 content-start gap-px overflow-auto bg-black/10"
        data-test="grid"
      >
        <div
          v-for="d in weekDays(anchor, ws)"
          :key="d"
          class="bg-white px-1 text-xs opacity-70 dark:bg-neutral-900"
        >
          {{ weekdayLabel(d) }}
        </div>
        <div
          v-for="d in days"
          :key="d"
          class="min-h-24 bg-white p-1 dark:bg-neutral-900"
          :class="[mode === 'month' && parse(d).getMonth() !== month && 'opacity-50']"
          :data-day="d"
          @dragover.prevent
          @drop.prevent="drop(d)"
        >
          <div class="text-xs" :class="d === today && 'font-bold text-blue-600'">
            {{ parse(d).getDate() }}
          </div>
          <button
            v-for="x in byDay.get(d)"
            :key="x.id"
            type="button"
            draggable="true"
            class="mt-0.5 block w-full truncate rounded bg-blue-500/15 px-1 text-left text-xs"
            :data-task="x.id"
            @dragstart="start($event, x, d)"
            @click="openTask(x.key)"
          >
            {{ x.title }}
          </button>
        </div>
      </div>
      <aside
        class="w-56 shrink-0 overflow-y-auto"
        data-test="undated"
        :aria-label="t('calendar.undated')"
      >
        <h3 class="mb-1 text-sm font-medium">{{ t('calendar.undated') }}</h3>
        <button
          v-for="x in undated"
          :key="x.id"
          type="button"
          draggable="true"
          class="mb-0.5 block w-full truncate rounded bg-black/5 px-2 py-1 text-left text-sm"
          :data-task="x.id"
          @dragstart="start($event, x, null)"
          @click="openTask(x.key)"
        >
          {{ x.title }}
        </button>
      </aside>
    </div>
  </div>
</template>
