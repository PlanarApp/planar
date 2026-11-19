<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ENGINE_IDS,
  ENGINE_RUN_STATES,
  type EngineEventView,
  type EngineHistory,
  type EngineId,
  type EngineMonitorView,
  type EngineRunView,
} from '../shared/index.js';
import { call } from './api';
import { mergeRuns } from './aiUi';
import { tr, type Key } from './data';
import {
  appendEvents,
  fmtAgo,
  fmtDuration,
  PERIODS,
  sinceOf,
  statusClass,
  type Period,
} from './engineUi';

// PLNRAPP-500: the engines monitor of the project — status cards and the live log (polled every 2 s by the
// cursor of events), the history of passes with filters, the manual run (a workspace admin);
// PLNRAPP-568: no projectId — all projects and the general passes
const props = defineProps<{ projectId?: string }>();
const mon = ref<EngineMonitorView | null>(null);
const events = ref<EngineEventView[]>([]);
const err = ref('');
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
let busyPoll = false;

async function poll() {
  if (busyPoll) return;
  busyPoll = true;
  try {
    const q = new URLSearchParams(props.projectId ? { projectId: props.projectId } : {});
    const last = events.value.at(-1);
    if (last) q.set('after', last.id);
    const r = await call<EngineMonitorView>('GET', `engines/monitor?${q}`);
    mon.value = r;
    const fresh = r.events.length > 0;
    events.value = appendEvents(events.value, r.events);
    now.value = Date.now();
    err.value = '';
    // something happened: the history shows it too
    if (fresh && last) void loadHistory();
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busyPoll = false;
  }
}

// the history
const engine = ref<'' | EngineId>('');
const state = ref('');
const period = ref<Period>('24h');
const active = ref(true);
const hist = ref<EngineHistory | null>(null);
async function loadHistory(more = false) {
  const q = new URLSearchParams({ limit: '50' });
  if (props.projectId) q.set('projectId', props.projectId);
  if (engine.value) q.set('engine', engine.value);
  if (state.value) q.set('state', state.value);
  if (active.value) q.set('active', '1');
  q.set('since', sinceOf(period.value));
  if (more && hist.value?.next) q.set('cursor', hist.value.next);
  try {
    const r = await call<EngineHistory>('GET', `engines/runs?${q}`);
    hist.value =
      more && hist.value ? { runs: mergeRuns(hist.value.runs, r.runs), next: r.next } : r;
  } catch (e) {
    err.value = (e as Error).message;
  }
}
watch([engine, state, period, active], () => void loadHistory());

// the manual run
// harnessOptimize — the harness engine's pass over the whole pack (shorten, dedupe, align)
const runEngine = ref<EngineId | 'harnessOptimize'>('tasks');
const runScope = ref<'project' | 'all'>(props.projectId ? 'project' : 'all');
const confirming = ref(false);
const runMsg = ref('');
async function run() {
  confirming.value = false;
  runMsg.value = '';
  const optimize = runEngine.value === 'harnessOptimize';
  try {
    const r = await call<{ aborted: number; queued: number }>('POST', 'engines/run', {
      engine: optimize ? 'harness' : runEngine.value,
      projectId: runScope.value === 'project' ? (props.projectId ?? null) : null,
      ...(optimize && { optimize }),
    });
    runMsg.value = `${tr('engRunDone')}${r.aborted ? `; ${tr('engRunAborted')}: ${r.aborted}` : ''}`;
    await poll();
  } catch (e) {
    err.value = (e as Error).message;
  }
}

const result = (r: EngineRunView) => tr(`er_${r.state}` as Key);
const cards = computed(() => mon.value?.engines ?? []);

onMounted(() => {
  void poll();
  void loadHistory();
  timer = setInterval(() => void poll(), 2000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="engine-monitor">
    <h4 class="font-medium">{{ tr('engTitle') }}</h4>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="engine-error">{{ err }}</p>
    <p v-if="mon && !mon.enabled" class="text-sm text-warning" data-testid="engine-off">
      {{ tr('engOff') }}
    </p>
    <div class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="c in cards"
        :key="c.engine"
        class="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
        :data-testid="`engine-card-${c.engine}`"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{ tr(`eng_${c.engine}` as Key) }}</span>
          <span
            class="rounded px-2 py-0.5 text-xs font-medium"
            :class="statusClass(c.status)"
            :data-testid="`engine-status-${c.engine}`"
            >{{ tr(`es_${c.status}` as Key) }}</span
          >
        </div>
        <p class="text-xs text-fg-muted">{{ tr(`eng_${c.engine}Hint` as Key) }}</p>
        <p v-if="c.status === 'running'">
          {{ tr('engNow') }}: {{ c.current ?? '…' }}
          <span v-if="c.runningSince" class="text-fg-muted"
            >({{ fmtDuration(c.runningSince, null, now) }})</span
          >
        </p>
        <p v-if="c.status === 'stalled'" class="text-danger">{{ tr('es_stalledHint') }}</p>
        <p v-if="c.lastError" class="text-danger">{{ c.lastError }}</p>
        <p class="text-fg-muted">
          {{ tr('engLast') }}: {{ fmtAgo(c.lastRunAt, now) }} · {{ tr('engLastAction') }}:
          {{ fmtAgo(c.lastActionAt, now) }}
        </p>
        <p class="text-xs text-fg-muted">
          {{ tr('engEvery') }} {{ c.everyMin }} {{ tr('engMin') }}
        </p>
      </div>
    </div>

    <div v-if="mon?.canRun" class="flex flex-col gap-2 text-sm" data-testid="engine-run">
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="runEngine"
          class="rounded-md border border-border bg-bg px-2 py-1"
          data-testid="engine-run-engine"
        >
          <option v-for="e in ENGINE_IDS" :key="e" :value="e">{{ tr(`eng_${e}` as Key) }}</option>
          <option value="harnessOptimize">{{ tr('eng_harnessOptimize') }}</option>
        </select>
        <select
          v-if="projectId"
          v-model="runScope"
          class="rounded-md border border-border bg-bg px-2 py-1"
          data-testid="engine-run-scope"
        >
          <option value="project">{{ tr('engRunThis') }}</option>
          <option value="all">{{ tr('engRunAll') }}</option>
        </select>
        <button
          v-if="!confirming"
          type="button"
          class="rounded-md border border-border px-3 py-1"
          data-testid="engine-run-btn"
          @click="confirming = true"
        >
          {{ tr('engRun') }}
        </button>
        <template v-else>
          <span>{{ tr('engRunConfirm') }}</span>
          <button
            type="button"
            class="rounded-md border border-border px-3 py-1"
            data-testid="engine-run-yes"
            @click="run"
          >
            {{ tr('engRunYes') }}
          </button>
          <button type="button" class="underline" @click="confirming = false">
            {{ tr('engRunNo') }}
          </button>
        </template>
        <span v-if="runMsg" class="text-fg-muted" data-testid="engine-run-done">{{ runMsg }}</span>
      </div>
      <p class="text-xs text-fg-muted">{{ tr('engRunHint') }}</p>
    </div>

    <h5 class="text-sm font-medium">{{ tr('engLog') }}</h5>
    <ol
      class="max-h-64 overflow-y-auto rounded-md border border-border p-2 font-mono text-xs"
      data-testid="engine-log"
    >
      <li v-for="e in events" :key="e.id" :class="e.level === 'error' && 'text-danger'">
        <span class="text-fg-muted">{{ new Date(e.at).toLocaleTimeString() }}</span>
        [{{ tr(`eng_${e.engine}` as Key) }}] {{ e.text }}
      </li>
      <li v-if="!events.length" class="text-fg-muted">{{ tr('engLogEmpty') }}</li>
    </ol>

    <h5 class="text-sm font-medium">{{ tr('engHistory') }}</h5>
    <div class="flex flex-wrap items-center gap-2 text-sm" data-testid="engine-filters">
      <select v-model="engine" class="rounded-md border border-border bg-bg px-2 py-1">
        <option value="">{{ tr('engAll') }}</option>
        <option v-for="e in ENGINE_IDS" :key="e" :value="e">{{ tr(`eng_${e}` as Key) }}</option>
      </select>
      <select
        v-model="state"
        class="rounded-md border border-border bg-bg px-2 py-1"
        data-testid="engine-filter-state"
      >
        <option value="">{{ tr('engAllResults') }}</option>
        <option v-for="s in ENGINE_RUN_STATES" :key="s" :value="s">
          {{ tr(`er_${s}` as Key) }}
        </option>
      </select>
      <select v-model="period" class="rounded-md border border-border bg-bg px-2 py-1">
        <option v-for="p in PERIODS" :key="p" :value="p">{{ tr(`ep_${p}` as Key) }}</option>
      </select>
      <label class="flex items-center gap-1">
        <input v-model="active" type="checkbox" data-testid="engine-filter-active" />
        {{ tr('engActive') }}
      </label>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs" data-testid="engine-history">
        <thead class="text-fg-muted">
          <tr>
            <th class="px-1 py-1">{{ tr('engColStart') }}</th>
            <th class="px-1 py-1">{{ tr('engColEnd') }}</th>
            <th class="px-1 py-1">{{ tr('engColDuration') }}</th>
            <th class="px-1 py-1">{{ tr('engColEngine') }}</th>
            <th class="px-1 py-1">{{ tr('engColProject') }}</th>
            <th class="px-1 py-1">{{ tr('engColResult') }}</th>
            <th class="px-1 py-1">{{ tr('engColProcessed') }}</th>
            <th class="px-1 py-1">{{ tr('engColError') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in hist?.runs ?? []" :key="r.id" class="border-t border-border align-top">
            <td class="px-1 py-1 whitespace-nowrap">
              {{ new Date(r.startedAt).toLocaleString() }}
            </td>
            <td class="px-1 py-1 whitespace-nowrap">
              {{ r.finishedAt ? new Date(r.finishedAt).toLocaleTimeString() : '—' }}
            </td>
            <td class="px-1 py-1 whitespace-nowrap">
              {{ fmtDuration(r.startedAt, r.finishedAt, now) }}
            </td>
            <td class="px-1 py-1">
              {{ tr(`eng_${r.engine}` as Key) }}: {{ tr(`ej_${r.job}` as Key) }} ({{
                tr(`et_${r.trigger}` as Key)
              }}<template v-if="r.userName">, {{ r.userName }}</template
              >)
            </td>
            <td class="px-1 py-1">{{ r.projectName ?? tr('engGeneral') }}</td>
            <td class="px-1 py-1">
              <span class="rounded px-1" :class="statusClass(r.state)">{{ result(r) }}</span>
            </td>
            <td class="px-1 py-1">{{ r.processed }}</td>
            <td class="px-1 py-1 text-danger">{{ r.error ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="hist && !hist.runs.length" class="text-sm text-fg-muted">{{ tr('engNoRuns') }}</p>
    <button
      v-if="hist?.next"
      type="button"
      class="w-fit rounded-md border border-border px-3 py-1 text-sm"
      @click="loadHistory(true)"
    >
      {{ tr('more') }}
    </button>
  </section>
</template>
