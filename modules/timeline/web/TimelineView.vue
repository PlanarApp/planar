<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Button,
  db,
  i18n,
  localToday,
  mutate,
  openTask,
  useScopeTasks,
  type ViewScope,
  useQuery,
  useWeekStart,
} from '@planar/web/modules';
import {
  barOf,
  dayWindow,
  dropArgs,
  fromDay,
  moveArgs,
  newViolations,
  PX,
  resizeArgs,
  ROW_H,
  rowWindow,
  span,
  ticks,
  toDay,
  violates,
  type Bar,
  type Link,
  type Scale,
} from './lib';

// scope — сводка группы: задачи и вехи её проектов
const props = defineProps<{ projectId: string; viewId?: string; scope?: ViewScope }>();
const pids = () => props.scope?.projectIds ?? [props.projectId];

const dict = {
  day: { ru: 'День', en: 'Day' },
  week: { ru: 'Неделя', en: 'Week' },
  month: { ru: 'Месяц', en: 'Month' },
  nodates: { ru: 'Без дат', en: 'No dates' },
  hint: { ru: 'Перетащите на шкалу', en: 'Drag onto the timeline' },
  warn: {
    ru: 'Нарушена зависимость: задача начинается не позже конца блокирующей',
    en: 'Dependency violated: task starts no later than its blocker ends',
  },
  empty: { ru: 'В проекте нет задач', en: 'No tasks in this project' },
} as const;
const tr = (k: keyof typeof dict) => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};

const tasks = useScopeTasks(pids);
const links = useQuery(async () => (await db.table('taskLinks').toArray()) as unknown as Link[]);
const weekStart = useWeekStart();
const scale = ref<Scale>('day');
const px = computed(() => PX[scale.value]);

// веха модуля goals: таблицы может не быть (модуль выключен — строк нет, C-modules)
const milestones = useQuery(async () =>
  db.tables.some((t) => t.name === 'goalsMilestones')
    ? ((await db.table('goalsMilestones').where('projectId').anyOf(pids()).toArray()) as {
        id: string;
        name: string;
        date: string;
      }[])
    : [],
);
const msDays = computed(() => (milestones.value ?? []).map((m) => ({ ...m, day: toDay(m.date) })));

const dated = computed(() => (tasks.value ?? []).filter((t) => barOf(t)));
const undated = computed(() => (tasks.value ?? []).filter((t) => !barOf(t)));
const bars = computed(() => new Map(dated.value.map((t) => [t.id, barOf(t)!])));
const rowOf = computed(() => new Map(dated.value.map((t, i) => [t.id, i])));
const barOfId = (id: string) => bars.value.get(id) ?? null;
const blocks = computed(() =>
  (links.value ?? []).filter(
    (l) => l.kind === 'blocks' && bars.value.has(l.taskId) && bars.value.has(l.targetId),
  ),
);

const today = toDay(localToday());
const range = computed(() =>
  span([...bars.value.values(), ...msDays.value.map((m) => ({ s: m.day, e: m.day }))], today),
);
const origin = computed(() => range.value[0]);
const width = computed(() => (range.value[1] - range.value[0] + 1) * px.value);
const height = computed(() => Math.max(dated.value.length, 1) * ROW_H);
const x = (day: number) => (day - origin.value) * px.value;

// окно виртуализации; в тестовой среде размеры равны 0 — берём запасные
const sc = ref<HTMLElement>();
const view = ref({ top: 0, left: 0, w: 900, h: 600 });
const rows = computed(() => {
  const [a, b] = rowWindow(view.value.top, view.value.h, dated.value.length);
  return dated.value.slice(a, b).map((t, i) => ({ t, i: a + i }));
});
const days = computed(() => dayWindow(view.value.left, view.value.w, origin.value, scale.value));
const visibleTicks = computed(() =>
  ticks(days.value[0], days.value[1], scale.value, weekStart.value).map((k) => ({
    ...k,
    left: x(k.day),
  })),
);

// стрелки: связи, у которых хотя бы один конец в окне строк, и по датам попадающие в видимый диапазон
const arrows = computed(() => {
  const [r0, r1] = rowWindow(view.value.top, view.value.h, dated.value.length);
  const [d0, d1] = days.value;
  const out: { id: string; d: string; bad: boolean }[] = [];
  for (const l of blocks.value) {
    const ra = rowOf.value.get(l.taskId)!;
    const rb = rowOf.value.get(l.targetId)!;
    const inRows = (r: number) => r >= r0 && r < r1;
    if (!inRows(ra) && !inRows(rb)) continue;
    const a = shown(l.taskId);
    const b = shown(l.targetId);
    if (Math.max(a.e + 1, b.s) < d0 || Math.min(a.e + 1, b.s) > d1) continue;
    const x1 = x(a.e + 1);
    const x2 = x(b.s);
    const y1 = ra * ROW_H + ROW_H / 2;
    const y2 = rb * ROW_H + ROW_H / 2;
    const mid = Math.max(x1 + 6, Math.min(x2 - 6, (x1 + x2) / 2));
    out.push({
      id: l.id,
      d: `M${x1} ${y1}H${mid}V${y2}H${x2}`,
      bad: violates(a, b),
    });
  }
  return out;
});

let raf = 0;
function measure() {
  raf = 0;
  const el = sc.value;
  if (!el) return;
  view.value = {
    top: el.scrollTop,
    left: el.scrollLeft,
    w: el.clientWidth || 900,
    h: el.clientHeight || 600,
  };
}
const onScroll = () => {
  if (!raf) raf = requestAnimationFrame(measure);
};

// перенос / растягивание мышью
interface Drag {
  id: string;
  mode: 'move' | 'start' | 'end';
  x0: number;
  dd: number;
}
const drag = ref<Drag | null>(null);
function shown(id: string): Bar {
  const b = bars.value.get(id)!;
  const d = drag.value;
  if (!d || d.id !== id || !d.dd) return b;
  if (d.mode === 'move') return { s: b.s + d.dd, e: b.e + d.dd };
  if (d.mode === 'start') return { s: Math.min(b.s + d.dd, b.e), e: b.e };
  return { s: b.s, e: Math.max(b.e + d.dd, b.s) };
}
function down(e: PointerEvent, id: string, mode: Drag['mode']) {
  e.preventDefault();
  drag.value = { id, mode, x0: e.clientX, dd: 0 };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
}
const move = (e: PointerEvent) => {
  if (drag.value) drag.value.dd = Math.round((e.clientX - drag.value.x0) / px.value);
};
const warning = ref(false);
let warnTimer: ReturnType<typeof setTimeout> | undefined;
async function up() {
  window.removeEventListener('pointermove', move);
  const d = drag.value;
  const t = d && tasks.value?.find((x) => x.id === d.id);
  const next = d && d.dd ? shown(d.id) : null;
  if (!d || !t || !next) return void (drag.value = null);
  const b = bars.value.get(d.id)!;
  const args =
    d.mode === 'move'
      ? moveArgs(t, d.dd)
      : resizeArgs(t, d.mode, d.mode === 'start' ? b.s + d.dd : b.e + d.dd);
  await commit(d.id, args, next);
  drag.value = null;
}

async function commit(id: string, args: Record<string, unknown>, next: Bar) {
  const bad = newViolations(blocks.value, barOfId, id, next);
  await mutate('task.update', args);
  if (!bad.length) return;
  warning.value = true;
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => (warning.value = false), 6000);
}

// «Без дат»: перетаскивание на шкалу
const ud = ref(0);
const udWin = computed(() => rowWindow(ud.value, view.value.h, undated.value.length));
const udRows = computed(() => undated.value.slice(udWin.value[0], udWin.value[1]));
function onDrop(e: DragEvent) {
  const id = e.dataTransfer?.getData('text/plain');
  const el = sc.value;
  if (!id || !el || !undated.value.some((t) => t.id === id)) return;
  e.preventDefault();
  const day =
    origin.value +
    Math.floor((e.clientX - el.getBoundingClientRect().left + el.scrollLeft) / px.value);
  void commit(id, dropArgs(id, day), { s: day, e: day });
}

onMounted(() => {
  measure();
  if (sc.value) sc.value.scrollLeft = Math.max(0, x(today) - 120);
  measure();
});
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', move);
  clearTimeout(warnTimer);
  if (raf) cancelAnimationFrame(raf);
});
watch(scale, () => {
  if (sc.value) sc.value.scrollLeft = Math.max(0, x(today) - 120);
  measure();
});
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" data-testid="timeline">
    <header class="flex items-center gap-2 px-4 py-2">
      <Button
        v-for="s in ['day', 'week', 'month'] as const"
        :key="s"
        size="sm"
        :variant="scale === s ? 'primary' : 'secondary'"
        :data-testid="`tl-scale-${s}`"
        :aria-pressed="scale === s"
        @click="scale = s"
      >
        {{ tr(s) }}
      </Button>
      <span
        v-if="warning"
        role="alert"
        class="rounded-md bg-danger-subtle px-2 py-1 text-sm text-danger"
        data-testid="tl-warning"
      >
        {{ tr('warn') }}
      </span>
    </header>
    <div v-if="tasks && !tasks.length" class="p-4 text-fg-muted">{{ tr('empty') }}</div>
    <div v-else class="flex min-h-0 flex-1">
      <div
        ref="sc"
        class="relative min-w-0 flex-1 overflow-auto border-t border-border"
        data-testid="tl-scroll"
        @scroll.passive="onScroll"
        @dragover.prevent
        @drop="onDrop"
      >
        <div
          class="sticky top-0 z-10 h-6 border-b border-border bg-bg"
          :style="{ width: width + 'px' }"
        >
          <span
            v-for="k in visibleTicks"
            :key="k.day"
            class="absolute top-0 border-l border-border pl-1 text-2xs text-fg-subtle"
            :style="{ left: k.left + 'px' }"
          >
            {{ k.label }}
          </span>
        </div>
        <div class="relative" :style="{ width: width + 'px', height: height + 'px' }">
          <div
            class="absolute inset-y-0 w-px bg-accent"
            :style="{ left: x(today) + 'px' }"
            aria-hidden="true"
          />
          <div
            v-for="m in msDays"
            :key="m.id"
            class="pointer-events-none absolute inset-y-0 w-px bg-warning"
            :style="{ left: x(m.day) + 'px' }"
            data-testid="tl-milestone"
          >
            <span class="absolute top-0 whitespace-nowrap pl-1 text-2xs text-warning">
              {{ m.name }}
            </span>
          </div>
          <div
            v-for="{ t, i } in rows"
            :key="t.id"
            role="row"
            class="absolute left-0 right-0"
            :style="{ top: i * ROW_H + 'px', height: ROW_H + 'px' }"
            :data-tl-task="t.key"
          >
            <div
              class="absolute top-1 flex h-6 cursor-grab touch-none select-none items-center rounded-sm bg-accent-subtle text-xs text-fg ring-1 ring-accent"
              :style="{
                left: x(shown(t.id).s) + 'px',
                width: (shown(t.id).e - shown(t.id).s + 1) * px + 'px',
              }"
              data-testid="tl-bar"
              @pointerdown="down($event, t.id, 'move')"
              @dblclick="openTask(t.key)"
            >
              <span
                class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                @pointerdown.stop="down($event, t.id, 'start')"
              />
              <span
                class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                @pointerdown.stop="down($event, t.id, 'end')"
              />
            </div>
            <span
              class="pointer-events-none absolute top-1 truncate whitespace-nowrap text-xs leading-6 text-fg-muted"
              :style="{ left: x(shown(t.id).e + 1) + 4 + 'px', maxWidth: '320px' }"
            >
              {{ t.title }}
            </span>
          </div>
          <svg
            class="pointer-events-none absolute left-0 top-0"
            :width="width"
            :height="height"
            aria-hidden="true"
          >
            <path
              v-for="a in arrows"
              :key="a.id"
              :d="a.d"
              fill="none"
              stroke-width="1.5"
              :class="a.bad ? 'stroke-danger' : 'stroke-fg-subtle'"
              :data-bad="a.bad || undefined"
              data-testid="tl-arrow"
            />
          </svg>
        </div>
      </div>
      <aside
        class="flex w-56 shrink-0 flex-col border-l border-t border-border"
        data-testid="tl-nodates"
      >
        <h3 class="px-3 py-1 text-sm font-medium">
          {{ tr('nodates') }} <span class="text-fg-subtle">{{ undated.length }}</span>
        </h3>
        <p class="px-3 pb-1 text-2xs text-fg-subtle">{{ tr('hint') }}</p>
        <div
          class="min-h-0 flex-1 overflow-auto"
          @scroll.passive="ud = ($event.target as HTMLElement).scrollTop"
        >
          <div class="relative" :style="{ height: undated.length * ROW_H + 'px' }">
            <div
              v-for="(t, i) in udRows"
              :key="t.id"
              draggable="true"
              class="absolute left-0 right-0 cursor-grab truncate px-3 text-sm leading-8 hover:bg-bg-muted"
              :style="{ top: (udWin[0] + i) * ROW_H + 'px', height: ROW_H + 'px' }"
              data-testid="tl-undated"
              @dragstart="$event.dataTransfer?.setData('text/plain', t.id)"
              @dblclick="openTask(t.key)"
            >
              {{ t.title }}
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
