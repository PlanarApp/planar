<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { AI_RUN_STATES, type AiMonitor } from '../shared/index.js';
import { call } from './api';
import { fmtCost, mergeRuns, usagePct } from './aiUi';
import { tr, type Key } from './data';
import RunRow from './RunRow.vue';

// «Settings → AI tasks» (instance admin): the switch, load and today's spending against the limits, all runs
const mon = ref<AiMonitor | null>(null);
const state = ref('');
const err = ref('');
const busy = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

const query = (cursor?: string) => {
  const q = new URLSearchParams({ limit: '50' });
  if (state.value) q.set('state', state.value);
  if (cursor) q.set('cursor', cursor);
  return `monitor?${q}`;
};
async function load(more = false) {
  try {
    const r = await call<AiMonitor>(
      'GET',
      query(more ? (mon.value?.next ?? undefined) : undefined),
    );
    mon.value = more && mon.value ? { ...r, runs: mergeRuns(mon.value.runs, r.runs) } : r;
    err.value = '';
  } catch (e) {
    err.value = (e as Error).message;
  }
}
async function toggle(e: Event) {
  const enabled = (e.target as HTMLInputElement).checked;
  busy.value = true;
  try {
    await call('PUT', 'settings', { enabled });
    if (mon.value) mon.value.enabled = enabled;
  } catch (x) {
    err.value = (x as Error).message;
  } finally {
    busy.value = false;
    await load();
  }
}
const bar = (used: number, limit: number | null) => usagePct(used, limit);
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 10000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="ai-monitor">
    <h2 class="text-lg font-semibold">{{ tr('monitorTitle') }}</h2>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <template v-if="mon">
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          :checked="mon.enabled"
          :disabled="busy"
          data-testid="ai-switch"
          @change="toggle"
        />
        {{ tr('switchOn') }}
      </label>
      <p class="text-xs text-fg-muted">{{ tr('switchHint') }}</p>
      <p v-if="!mon.runner" class="text-sm text-warning" data-testid="ai-no-runner">
        {{ tr('noRunner') }}
      </p>
      <dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="ai-load">
        <dt class="text-fg-muted">{{ tr('load') }}</dt>
        <dd>
          {{ tr('st_running') }}: {{ mon.load.running }}, {{ tr('waiting') }}:
          {{ mon.load.waiting }}
        </dd>
        <dt class="text-fg-muted">{{ tr('todayUsed') }}, {{ tr('tokens') }}</dt>
        <dd>
          {{ mon.today.tokens }} / {{ mon.limits.dailyTokens ?? tr('noLimit') }}
          <span v-if="bar(mon.today.tokens, mon.limits.dailyTokens) !== null"
            >({{ bar(mon.today.tokens, mon.limits.dailyTokens) }}%)</span
          >
        </dd>
        <dt class="text-fg-muted">{{ tr('todayUsed') }}, {{ tr('cost') }}</dt>
        <dd>
          {{ fmtCost(mon.today.cost) }} /
          {{ mon.limits.dailyCost == null ? tr('noLimit') : fmtCost(mon.limits.dailyCost) }}
          <span v-if="bar(mon.today.cost, mon.limits.dailyCost) !== null"
            >({{ bar(mon.today.cost, mon.limits.dailyCost) }}%)</span
          >
        </dd>
      </dl>
      <p class="text-xs text-fg-muted">{{ tr('limitInst') }}</p>
      <select
        v-model="state"
        class="w-fit rounded-md border border-border bg-bg px-2 py-1 text-sm"
        data-testid="ai-state-filter"
        @change="load()"
      >
        <option value="">{{ tr('allStates') }}</option>
        <option v-for="s in AI_RUN_STATES" :key="s" :value="s">{{ tr(`st_${s}` as Key) }}</option>
      </select>
      <ul class="flex flex-col gap-2">
        <RunRow
          v-for="r in mon.runs"
          :key="r.id"
          :run="r"
          :title="`${r.projectName} · ${r.taskKey} ${r.taskTitle}`"
          @changed="load()"
        />
      </ul>
      <p v-if="!mon.runs.length" class="text-sm text-fg-muted">{{ tr('noRuns') }}</p>
      <button
        v-if="mon.next"
        type="button"
        class="w-fit rounded-md border border-border px-3 py-1 text-sm"
        data-testid="ai-more"
        @click="load(true)"
      >
        {{ tr('more') }}
      </button>
    </template>
  </section>
</template>
