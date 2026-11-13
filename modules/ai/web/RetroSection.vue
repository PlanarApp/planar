<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { call } from './api';
import { tr } from './data';

// harness-retro of a project (PLNRAPP-178): the switch and how often the retro runs
const props = defineProps<{ projectId: string }>();
interface View {
  enabled: boolean;
  everyFrictions: number;
  everyDays: number;
  taskId: string | null;
  taskKey: string | null;
}
const v = ref<View | null>(null);
const enabled = ref(true);
const frictions = ref('');
const days = ref('');
const err = ref('');
const done = ref(false);

const fill = (r: View) => {
  v.value = r;
  enabled.value = r.enabled;
  frictions.value = String(r.everyFrictions);
  days.value = String(r.everyDays);
};
const q = () => `retro?projectId=${props.projectId}`;
const int = (s: string, max: number) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined;
};
async function save() {
  err.value = '';
  done.value = false;
  const everyFrictions = int(frictions.value, 1000);
  const everyDays = int(days.value, 365);
  if (everyFrictions === undefined || everyDays === undefined)
    return void (err.value = tr('invalid'));
  try {
    fill(await call<View>('PUT', q(), { enabled: enabled.value, everyFrictions, everyDays }));
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
  <section class="flex flex-col gap-2" data-testid="ai-retro">
    <h3 class="font-medium">{{ tr('retroTitle') }}</h3>
    <p class="text-sm text-fg-muted">{{ tr('retroHint') }}</p>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="ai-retro-error">
      {{ err }}
    </p>
    <form v-if="v" class="flex flex-col gap-2" @submit.prevent="save">
      <label class="flex items-center gap-2 text-sm">
        <input v-model="enabled" type="checkbox" data-testid="ai-retro-enabled" />
        {{ tr('retroEnabled') }}
        <a
          v-if="v.taskKey"
          :href="`/t/${v.taskKey}`"
          class="underline"
          data-testid="ai-retro-task"
          >{{ v.taskKey }}</a
        >
      </label>
      <div class="flex flex-wrap gap-2">
        <label class="flex flex-1 flex-col gap-1 text-sm"
          >{{ tr('retroFrictions') }}
          <input
            v-model="frictions"
            type="number"
            min="1"
            max="1000"
            step="1"
            :disabled="!enabled"
            data-testid="ai-retro-frictions"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
        <label class="flex flex-1 flex-col gap-1 text-sm"
          >{{ tr('retroDays') }}
          <input
            v-model="days"
            type="number"
            min="1"
            max="365"
            step="1"
            :disabled="!enabled"
            data-testid="ai-retro-days"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="submit"
          data-testid="ai-retro-save"
          class="rounded-md border border-border px-3 py-1"
        >
          {{ tr('saveBtn') }}
        </button>
        <span v-if="done" class="text-sm text-fg-muted" data-testid="ai-retro-saved">{{
          tr('saved')
        }}</span>
      </div>
    </form>
  </section>
</template>
