<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AiLimits } from '../shared/index.js';
import { call } from './api';
import { fmtCost, parseLimit, usagePct } from './aiUi';
import { tr } from './data';

// Daily limits of a project (admin of the project); empty — the instance limit applies
const props = defineProps<{ projectId: string }>();
type View = AiLimits & { effective: AiLimits; usedToday: { tokens: number; cost: number } };
const v = ref<View | null>(null);
const tokens = ref('');
const cost = ref('');
const err = ref('');
const done = ref(false);

const fill = (r: View) => {
  v.value = r;
  tokens.value = r.dailyTokens == null ? '' : String(r.dailyTokens);
  cost.value = r.dailyCost == null ? '' : String(r.dailyCost);
};
const q = () => `limits?projectId=${props.projectId}`;
async function save() {
  err.value = '';
  done.value = false;
  const dailyTokens = parseLimit(tokens.value);
  const dailyCost = parseLimit(cost.value);
  if (dailyTokens === undefined || dailyCost === undefined) return void (err.value = tr('invalid'));
  try {
    fill(await call<View>('PUT', q(), { dailyTokens, dailyCost }));
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
  <section class="flex flex-col gap-2" data-testid="ai-limits">
    <h3 class="font-medium">{{ tr('limitsTitle') }}</h3>
    <p class="text-sm text-fg-muted">{{ tr('limitsHint') }}</p>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="ai-limits-error">
      {{ err }}
    </p>
    <form v-if="v" class="flex flex-col gap-2" @submit.prevent="save">
      <div class="flex flex-wrap gap-2">
        <label class="flex flex-1 flex-col gap-1 text-sm"
          >{{ tr('dailyTokens') }}
          <input
            v-model="tokens"
            type="number"
            min="1"
            step="1"
            :placeholder="
              v.effective.dailyTokens == null ? tr('noLimit') : String(v.effective.dailyTokens)
            "
            data-testid="ai-limit-tokens"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
        <label class="flex flex-1 flex-col gap-1 text-sm"
          >{{ tr('dailyCost') }}
          <input
            v-model="cost"
            type="number"
            min="0.01"
            step="any"
            :placeholder="
              v.effective.dailyCost == null ? tr('noLimit') : String(v.effective.dailyCost)
            "
            data-testid="ai-limit-cost"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
      </div>
      <p class="text-sm text-fg-muted" data-testid="ai-limits-used">
        {{ tr('todayUsed') }}: {{ v.usedToday.tokens }} {{ tr('tokens') }}
        <template v-if="usagePct(v.usedToday.tokens, v.effective.dailyTokens) !== null"
          >({{ usagePct(v.usedToday.tokens, v.effective.dailyTokens) }}%)</template
        >, {{ fmtCost(v.usedToday.cost) }}
        <template v-if="usagePct(v.usedToday.cost, v.effective.dailyCost) !== null"
          >({{ usagePct(v.usedToday.cost, v.effective.dailyCost) }}%)</template
        >
      </p>
      <div class="flex items-center gap-3">
        <button
          type="submit"
          data-testid="ai-limits-save"
          class="rounded-md border border-border px-3 py-1"
        >
          {{ tr('saveBtn') }}
        </button>
        <span v-if="done" class="text-sm text-fg-muted" data-testid="ai-limits-saved">{{
          tr('saved')
        }}</span>
      </div>
    </form>
  </section>
</template>
