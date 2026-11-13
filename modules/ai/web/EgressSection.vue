<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { call } from './api';
import { tr } from './data';

// Agents' egress of a cloud instance (PLNRAPP-242): the owner decides, the cloud applies; not in the cloud — hidden
type Egress = { mode: 'open' | 'allowlist'; domains: string[] };
// the same check as the cloud's (cloud-link POST /api/link/egress) — here only for a quick hint
const DOMAIN_RE = /^\.?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const shown = ref(false);
const mode = ref<Egress['mode']>('open');
const text = ref('');
const err = ref('');
const done = ref(false);
const busy = ref(false);

const fill = (e: Egress) => {
  mode.value = e.mode;
  text.value = e.domains.join('\n');
};
async function save() {
  err.value = '';
  done.value = false;
  const domains = text.value
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const bad = domains.find((d) => !DOMAIN_RE.test(d));
  if (mode.value === 'allowlist' && bad) return void (err.value = `${tr('egressBad')}: ${bad}`);
  busy.value = true;
  try {
    const s = await call<{ egress: Egress }>('POST', '/api/cloud/egress', {
      domains: mode.value === 'open' ? null : domains,
    });
    fill(s.egress);
    done.value = true;
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() =>
  call<{ egress: Egress }>('GET', '/api/cloud').then(
    (s) => {
      fill(s.egress);
      shown.value = true;
    },
    () => {}, // not a cloud instance (404) or the cloud is unavailable — no form
  ),
);
</script>

<template>
  <section v-if="shown" class="flex flex-col gap-2" data-testid="ai-egress">
    <h3 class="font-medium">{{ tr('egressTitle') }}</h3>
    <p class="text-sm text-fg-muted">{{ tr('egressHint') }}</p>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="ai-egress-error">
      {{ err }}
    </p>
    <form class="flex flex-col gap-2" @submit.prevent="save">
      <label class="flex items-center gap-2 text-sm">
        <input v-model="mode" type="radio" value="open" data-testid="ai-egress-open" />
        {{ tr('egressOpen') }}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="mode" type="radio" value="allowlist" data-testid="ai-egress-list" />
        {{ tr('egressList') }}
      </label>
      <label v-if="mode === 'allowlist'" class="flex flex-col gap-1 text-sm"
        >{{ tr('egressDomains') }}
        <textarea
          v-model="text"
          rows="5"
          spellcheck="false"
          data-testid="ai-egress-domains"
          class="rounded-md border border-border bg-bg px-2 py-1 font-mono"
        />
      </label>
      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="busy"
          data-testid="ai-egress-save"
          class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
        >
          {{ tr(busy ? 'saving' : 'save') }}
        </button>
        <span v-if="done" class="text-sm text-fg-muted" data-testid="ai-egress-saved">{{
          tr('saved')
        }}</span>
      </div>
    </form>
  </section>
</template>
