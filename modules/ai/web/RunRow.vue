<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { AiRunDetails, AiRunEvent, AiRunEvents, AiRunView } from '../shared/index.js';
import { call } from './api';
import { canRestart, canStop, fmtCost, foldOf, mergeEvents } from './aiUi';
import { tr, type Key } from './data';

// One run: state, tokens / cost, the log on demand, «Stop» / «Restart»; the new run's id goes up after a restart.
// The log: the agent's events (PLNRAPP-199) — live while the run is running — and the api's journal of the run.
const props = defineProps<{ run: AiRunView; title?: string; open?: boolean }>();
const emit = defineEmits<{ changed: [openId?: string] }>();
const log = ref<string | null>(null);
const events = ref<AiRunEvent[]>([]);
const box = ref<HTMLElement | null>(null);
const err = ref('');
const busy = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
/** a pull saw the run running: when it ends, the api's journal is fetched again for its final lines */
let live = false;

/** Events after the cursor; polls while the run is running, scrolls down if the reader is at the bottom. */
async function pull() {
  clearTimeout(timer);
  if (log.value === null) return;
  try {
    const after = events.value.at(-1)?.id ?? 0;
    const r = await call<AiRunEvents>('GET', `runs/${props.run.id}/events?after=${after}`);
    if (log.value === null) return;
    const el = box.value;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (r.events.length) {
      events.value = mergeEvents(events.value, r.events);
      if (atBottom)
        void nextTick(() => {
          const b = box.value;
          if (b) b.scrollTo({ top: b.scrollHeight });
        });
    }
    if (r.state === 'running') {
      live = true;
      timer = setTimeout(pull, r.events.length ? 1500 : 3000);
    } else if (live) {
      live = false;
      log.value = (await call<{ run: AiRunDetails }>('GET', `runs/${props.run.id}`)).run.log;
    }
  } catch (e) {
    err.value = (e as Error).message;
  }
}

async function toggleLog() {
  clearTimeout(timer);
  if (log.value !== null) return void ((log.value = null), (events.value = []));
  try {
    log.value = (await call<{ run: AiRunDetails }>('GET', `runs/${props.run.id}`)).run.log;
    await pull();
  } catch (e) {
    err.value = (e as Error).message;
  }
}
onBeforeUnmount(() => clearTimeout(timer));
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
    <template v-if="log !== null">
      <div
        v-if="events.length"
        ref="box"
        class="flex max-h-96 flex-col gap-1 overflow-auto rounded bg-bg-subtle p-2 text-xs"
        :aria-label="tr('agentLog')"
        data-testid="ai-run-events"
      >
        <div v-for="e in events" :key="e.id" :data-type="e.type" data-testid="ai-run-event">
          <span class="font-medium text-fg-muted"
            >{{ tr(`ev_${e.type}` as Key) }}<template v-if="e.tool"> · {{ e.tool }}</template></span
          >
          <details v-if="foldOf(e.text)" class="ml-2">
            <summary
              class="cursor-pointer whitespace-pre-wrap break-words"
              :class="{ 'font-mono': e.type !== 'thought' }"
            >
              {{ foldOf(e.text) }}
            </summary>
            <pre class="whitespace-pre-wrap break-words">{{ e.text }}</pre>
          </details>
          <pre
            v-else
            class="ml-2 whitespace-pre-wrap break-words"
            :class="{
              'font-sans': e.type === 'thought',
              'font-medium': e.type === 'result',
            }"
            >{{ e.type === 'command' ? `$ ${e.text}` : e.text }}</pre>
        </div>
      </div>
      <pre
        v-if="log || !events.length"
        class="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle p-2 text-xs"
        :aria-label="tr('apiLog')"
        data-testid="ai-run-log-text"
        >{{ log || tr('emptyLog') }}</pre>
    </template>
  </li>
</template>
