<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AiLimits } from '../shared/index.js';
import { call } from './api';
import { parseLimit } from './aiUi';
import { tr } from './data';

// PLNRAPP-500: the section «Автопилот» — the project's switch and its guard (PLNRAPP-408, moved here from
// the limits); PLNRAPP-568: shown in the project AI settings and in the tab «Монитор движков» of the workspace AI settings
const props = defineProps<{ projectId: string }>();
type View = AiLimits & {
  autopilot: boolean;
  effective: AiLimits;
  usedToday: { tasks: number };
};
const v = ref<View | null>(null);
const autopilot = ref(false);
const tasks = ref('');
const err = ref('');
const done = ref(false);

const fill = (r: View) => {
  v.value = r;
  autopilot.value = r.autopilot;
  tasks.value = r.dailyTasks == null ? '' : String(r.dailyTasks);
};
const q = () => `limits?projectId=${props.projectId}`;
async function save() {
  err.value = '';
  done.value = false;
  const dailyTasks = parseLimit(tasks.value);
  if (dailyTasks === undefined) return void (err.value = tr('invalid'));
  try {
    fill(await call<View>('PUT', q(), { dailyTasks, autopilot: autopilot.value }));
    done.value = true;
  } catch (e) {
    err.value = (e as Error).message;
  }
}
onMounted(() =>
  call<View>('GET', q())
    .then(fill)
    .catch((e) => (err.value = (e as Error).message)),
);
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="ai-autopilot-section">
    <h3 class="font-medium">{{ tr('apTitle') }}</h3>
    <p class="text-sm text-fg-muted">{{ tr('apHint') }}</p>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="ai-autopilot-error">
      {{ err }}
    </p>
    <form v-if="v" class="flex flex-col gap-2" @submit.prevent="save">
      <label class="flex items-start gap-2 text-sm">
        <input v-model="autopilot" type="checkbox" class="mt-1" data-testid="ai-autopilot" />
        <span
          >{{ tr('autopilot') }}
          <span class="block text-fg-muted">{{ tr('autopilotHint') }}</span></span
        >
      </label>
      <label class="flex max-w-xs flex-col gap-1 text-sm"
        >{{ tr('dailyTasks') }}
        <input
          v-model="tasks"
          type="number"
          min="1"
          step="1"
          :placeholder="String(v.effective.dailyTasks)"
          data-testid="ai-limit-tasks"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <p class="text-sm text-fg-muted" data-testid="ai-autopilot-used">
        {{ tr('todayUsed') }}: {{ v.usedToday.tasks }} / {{ v.effective.dailyTasks }}
        {{ tr('tasksUnit') }}
      </p>
      <div class="flex items-center gap-3">
        <button
          type="submit"
          data-testid="ai-autopilot-save"
          class="rounded-md border border-border px-3 py-1"
        >
          {{ tr('saveBtn') }}
        </button>
        <span v-if="done" class="text-sm text-fg-muted" data-testid="ai-autopilot-saved">{{
          tr('saved')
        }}</span>
      </div>
    </form>
  </section>
</template>
