<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStatuses } from '../../../apps/web/src/tasks';
import { newId } from '../../../apps/web/src/sync';
import { Button, Input } from '../../../apps/web/src/ui';
import { addDays, todayIn } from '../shared/index.js';
import { burnup } from './burnup';
import { browserTz, currentCycle, run, text, useSprintData } from './data';

const props = defineProps<{ projectId: string; viewId?: string }>();
const data = useSprintData(() => props.projectId);
const tx = computed(text);
const settings = computed(() => data.value?.settings ?? null);
const tz = computed(() => settings.value?.timezone ?? browserTz());
const cycle = computed(() => currentCycle(data.value?.cycles ?? [], tz.value));
const spaceId = computed(() => data.value?.cycles[0]?.spaceId ?? settings.value?.spaceId ?? '');
const statuses = useStatuses(spaceId);
const inCycle = computed(() =>
  (data.value?.tasks ?? []).filter((t) => t.cycleId === cycle.value?.id),
);

const CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;
const counts = computed(() => {
  const cat = new Map((statuses.value ?? []).map((s) => [s.id, s.category]));
  return CATEGORIES.map((c) => ({
    c,
    n: inCycle.value.filter((t) => cat.get(t.statusId) === c).length,
  }));
});
const total = computed(() => inCycle.value.length);
const donePct = computed(() =>
  total.value ? Math.round((counts.value.find((x) => x.c === 'done')!.n / total.value) * 100) : 0,
);
const COLORS: Record<string, string> = {
  backlog: '#94a3b8',
  todo: '#64748b',
  in_progress: '#3b82f6',
  done: '#22c55e',
  cancelled: '#ef4444',
};

// burn-up: SVG 300x120, ось X — дни цикла, Y — число задач
const W = 300;
const H = 120;
const chart = computed(() => {
  const c = cycle.value;
  if (!c) return null;
  const b = burnup(c, inCycle.value, todayIn(tz.value), tz.value);
  const max = Math.max(1, b.scope);
  const x = (i: number) => (b.days.length > 1 ? (i / (b.days.length - 1)) * W : 0);
  const y = (n: number) => H - (n / max) * H;
  return {
    b,
    scopeY: y(b.scope),
    done: b.done
      .flatMap((n, i) => (n === null ? [] : [`${x(i).toFixed(1)},${y(n).toFixed(1)}`]))
      .join(' '),
  };
});

const err = ref('');
const length = ref('');
const zone = ref('');
async function configure(over: Record<string, unknown>) {
  err.value = '';
  try {
    await run('sprints.configure', { projectId: props.projectId, ...over });
  } catch {
    err.value = tx.value.badTz;
  }
}
const enable = () => configure({ enabled: true, timezone: browserTz() });
const saveLength = () => length.value && configure({ lengthDays: Number(length.value) });
const saveZone = () => zone.value && configure({ timezone: zone.value });
function createCycle() {
  const last = (data.value?.cycles ?? []).at(-1);
  const start =
    last && last.endDate >= todayIn(tz.value) ? addDays(last.endDate, 1) : todayIn(tz.value);
  return run('sprints.create', { id: newId(), projectId: props.projectId, startDate: start });
}
const closeCycle = () => run('sprints.close', { id: cycle.value!.id, nextId: newId() });
</script>

<template>
  <div class="flex flex-col gap-4 p-4" data-testid="sprint-view">
    <div v-if="!settings?.enabled" class="flex items-center gap-3">
      <Button variant="primary" data-role="enable" @click="enable">{{ tx.enable }}</Button>
    </div>
    <template v-else>
      <section v-if="cycle" class="flex flex-col gap-3" data-testid="sprint-current">
        <header class="flex flex-wrap items-center gap-3">
          <h2 class="text-lg font-semibold">
            {{ tx.title }} {{ cycle.number
            }}<template v-if="cycle.name"> · {{ cycle.name }}</template>
          </h2>
          <span class="text-sm text-fg-muted">{{ cycle.startDate }} — {{ cycle.endDate }}</span>
          <Button size="sm" data-role="close" @click="closeCycle">{{ tx.close }}</Button>
        </header>

        <div>
          <h3 class="mb-1 text-sm font-medium">{{ tx.progress }}: {{ donePct }}%</h3>
          <div
            class="flex h-3 overflow-hidden rounded bg-bg-muted"
            role="img"
            :aria-label="tx.progress"
          >
            <div
              v-for="x in counts.filter((k) => k.n)"
              :key="x.c"
              :style="{ width: `${(x.n / total) * 100}%`, background: COLORS[x.c] }"
              :data-cat="x.c"
            />
          </div>
          <ul class="mt-1 flex flex-wrap gap-x-4 text-sm text-fg-muted">
            <li v-for="x in counts" :key="x.c" :data-count="x.c">{{ tx.cat[x.c] }}: {{ x.n }}</li>
          </ul>
        </div>

        <div v-if="chart">
          <h3 class="mb-1 text-sm font-medium">{{ tx.burnup }}</h3>
          <svg
            :viewBox="`0 0 ${W} ${H}`"
            class="h-32 w-full max-w-xl"
            role="img"
            :aria-label="tx.burnup"
            data-testid="burnup"
          >
            <line
              x1="0"
              :y1="chart.scopeY"
              :x2="W"
              :y2="chart.scopeY"
              stroke="#64748b"
              stroke-dasharray="4 3"
            />
            <polyline :points="chart.done" fill="none" stroke="#22c55e" stroke-width="2" />
          </svg>
          <p class="text-sm text-fg-muted">
            {{ tx.scope }}: {{ chart.b.scope }} {{ tx.tasks }} · {{ tx.done }}:
            {{ chart.b.done.filter((n) => n !== null).at(-1) ?? 0 }}
          </p>
        </div>
      </section>
      <p v-else class="text-fg-muted" data-testid="sprint-none">{{ tx.none }}</p>

      <div>
        <Button size="sm" data-role="create" @click="createCycle">{{ tx.create }}</Button>
      </div>

      <section class="flex flex-col gap-2" data-testid="sprint-settings">
        <h3 class="text-sm font-medium">{{ tx.settings }}</h3>
        <div class="flex flex-wrap items-end gap-3">
          <Input
            v-model="length"
            :label="`${tx.length} (${settings.lengthDays})`"
            data-role="length"
            @blur="saveLength"
          />
          <Input
            v-model="zone"
            :label="`${tx.timezone} (${settings.timezone})`"
            data-role="timezone"
            @blur="saveZone"
          />
          <label class="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              data-role="autoCreate"
              :checked="settings.autoCreate"
              @change="configure({ autoCreate: ($event.target as HTMLInputElement).checked })"
            />
            {{ tx.autoCreate }}
          </label>
        </div>
        <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
      </section>
    </template>
  </div>
</template>
