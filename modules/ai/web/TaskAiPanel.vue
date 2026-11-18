<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { TASK_ACTIVITY } from '@planar/web/modules';
import type { AiRunView } from '../shared/index.js';
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
onMounted(load);
watch(() => props.taskId, load);
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
