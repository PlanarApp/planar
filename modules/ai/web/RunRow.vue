<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AiRunDetails, AiRunView } from '../shared/index.js';
import { call } from './api';
import { canRestart, canStop, fmtCost } from './aiUi';
import { tr, type Key } from './data';

// One run: state, tokens / cost, the log on demand, «Stop» / «Restart»; the new run's id goes up after a restart
const props = defineProps<{ run: AiRunView; title?: string; open?: boolean }>();
const emit = defineEmits<{ changed: [openId?: string] }>();
const log = ref<string | null>(null);
const err = ref('');
const busy = ref(false);

async function toggleLog() {
  if (log.value !== null) return void (log.value = null);
  try {
    log.value = (await call<{ run: AiRunDetails }>('GET', `runs/${props.run.id}`)).run.log;
  } catch (e) {
    err.value = (e as Error).message;
  }
}
async function act(what: 'stop' | 'restart') {
  err.value = '';
  busy.value = true;
  try {
    const r = await call<{ runId: string } | undefined>('POST', `runs/${props.run.id}/${what}`);
    emit('changed', r?.runId);
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
// the run just made by a restart opens with its log
onMounted(() => props.open && toggleLog());
const btn = 'rounded-md border border-border px-2 py-0.5 text-sm disabled:opacity-50';
</script>

<template>
  <li class="flex flex-col gap-1 rounded-md border border-border p-2" data-testid="ai-run">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span class="font-medium" data-testid="ai-run-state">{{ tr(`st_${run.state}` as Key) }}</span>
      <span v-if="title" class="min-w-0 truncate">{{ title }}</span>
      <span class="text-fg-muted">{{ run.actionName ?? tr(`k_${run.kind}` as Key) }}</span>
      <span v-if="run.restartOf" class="text-fg-muted">{{ tr('restartOf') }}</span>
      <span class="text-fg-muted"
        >{{ run.inputTokens + run.outputTokens }} {{ tr('tokens') }}, {{ fmtCost(run.cost) }}</span
      >
      <time class="text-fg-muted" :datetime="run.createdAt">{{
        new Date(run.createdAt).toLocaleString()
      }}</time>
      <span class="ml-auto flex gap-2">
        <button type="button" :class="btn" data-testid="ai-run-log" @click="toggleLog">
          {{ tr(log === null ? 'showLog' : 'hideLog') }}
        </button>
        <button
          v-if="canStop(run.state)"
          type="button"
          :class="btn"
          :disabled="busy"
          data-testid="ai-run-stop"
          @click="act('stop')"
        >
          {{ tr('stop') }}
        </button>
        <button
          v-if="canRestart(run)"
          type="button"
          :class="btn"
          :disabled="busy"
          data-testid="ai-run-restart"
          @click="act('restart')"
        >
          {{ tr('restart') }}
        </button>
      </span>
    </div>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <pre
      v-if="log !== null"
      class="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle p-2 text-xs"
      data-testid="ai-run-log-text"
      >{{ log || tr('emptyLog') }}</pre>
  </li>
</template>
