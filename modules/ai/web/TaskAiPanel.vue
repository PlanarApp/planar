<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { TASK_ACTIVITY } from '@planar/web/modules';
import type { AiRunView, AiTaskRule } from '../shared/index.js';
import { AiApiError, call } from './api';
import { isLive } from './aiUi';
import { tr } from './data';
import RunRow from './RunRow.vue';

// Tab «AI» of a task (taskPanels): the task's runs; the server answers 404 to those who may not see them
const props = defineProps<{ taskId: string }>();
const runs = ref<AiRunView[] | null>(null);
const denied = ref(false);
const err = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  clearTimeout(timer);
  try {
    runs.value = (await call<{ runs: AiRunView[] }>('GET', `tasks/${props.taskId}/runs`)).runs;
    denied.value = false;
    err.value = '';
  } catch (e) {
    if (e instanceof AiApiError && (e.status === 404 || e.status === 403)) denied.value = true;
    else err.value = (e as Error).message;
  }
  // a live run changes: poll while there is one
  if (runs.value?.some((r) => isLive(r.state))) timer = setTimeout(load, 5000);
}
// after a restart the new run is not in the DB yet (the queue creates it): refetch, and keep polling until it shows
const fresh = ref('');
async function changed(openId?: string) {
  if (openId) fresh.value = openId;
  await load();
  if (openId && !runs.value?.some((r) => r.id === openId))
    timer = setTimeout(changed, 1500, openId);
}
// PLNRAPP-829: a manual start — a rule of the project with AI actions; its runs show in the list at once (queued)
const rules = ref<AiTaskRule[]>([]);
const ruleId = ref('');
const starting = ref(false);
const startErr = ref('');
async function loadRules() {
  try {
    rules.value =
      (await call<{ rules?: AiTaskRule[] }>('GET', `tasks/${props.taskId}/rules`)).rules ?? [];
  } catch {
    rules.value = [];
  }
  if (!rules.value.some((r) => r.id === ruleId.value)) ruleId.value = rules.value[0]?.id ?? '';
}
async function start() {
  if (!ruleId.value) return;
  startErr.value = '';
  starting.value = true;
  try {
    const r = await call<{ runIds: string[] }>('POST', `tasks/${props.taskId}/runs`, {
      ruleId: ruleId.value,
    });
    await changed(r.runIds[0]);
  } catch (e) {
    startErr.value = (e as Error).message;
  } finally {
    starting.value = false;
  }
}
const ruleLabel = (r: AiTaskRule) => `${r.name} — ${r.actions.join(', ')}`;
async function init() {
  await load();
  if (!denied.value) await loadRules();
}
onMounted(init);
watch(() => props.taskId, init);
// PLNRAPP-532: a run started or changed by an event (a rule on a status change, a comment) — the card's
// indicator sees it (replica changes + polling), the list follows: reloaded when the task's work changes
const work = inject(TASK_ACTIVITY, null);
if (work)
  watch(
    () => work.items.value.map((a) => `${a.id}:${a.state}`).join(),
    () => void load(),
  );
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="ai-task-panel">
    <form
      v-if="!denied && rules.length"
      class="flex flex-wrap items-center gap-2 text-sm"
      data-testid="ai-start"
      @submit.prevent="start"
    >
      <select
        v-model="ruleId"
        class="min-w-0 max-w-full rounded-md border border-border bg-bg px-2 py-1"
        :aria-label="tr('startRule')"
        data-testid="ai-start-rule"
      >
        <option v-for="r in rules" :key="r.id" :value="r.id">{{ ruleLabel(r) }}</option>
      </select>
      <button
        type="submit"
        class="rounded-md border border-border px-2 py-0.5 disabled:opacity-50"
        :disabled="starting || !ruleId"
        data-testid="ai-start-run"
      >
        {{ tr('startRun') }}
      </button>
      <p v-if="startErr" role="alert" class="w-full text-danger">{{ startErr }}</p>
    </form>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <p v-else-if="denied" class="text-sm text-fg-muted" data-testid="ai-denied">
      {{ tr('noAccess') }}
    </p>
    <p v-else-if="runs && !runs.length" class="text-sm text-fg-muted">{{ tr('noRuns') }}</p>
    <ul v-else-if="runs" class="flex flex-col gap-2">
      <RunRow v-for="r in runs" :key="r.id" :run="r" :open="r.id === fresh" @changed="changed" />
    </ul>
  </section>
</template>
