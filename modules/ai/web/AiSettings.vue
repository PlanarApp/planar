<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { AI_PROVIDERS, type AiConnectionView } from '../shared/index.js';
import { call } from './api';
import { tr } from './data';
import PacksSection from './PacksSection.vue';

// «Settings → AI»: the connection of one level; the key is only sent, never shown
const props = defineProps<{
  level: 'instance' | 'space' | 'project';
  spaceId?: string;
  projectId?: string;
}>();
const own = ref<AiConnectionView | null>(null);
const effective = ref<AiConnectionView | null>(null);
const err = ref('');
const done = ref(false);
const busy = ref(false);
const f = reactive({
  provider: 'openai' as (typeof AI_PROVIDERS)[number],
  baseUrl: '',
  apiKey: '',
  model: '',
  priceIn: '',
  priceOut: '',
});

const scopeId = computed(() =>
  props.level === 'instance'
    ? undefined
    : props.level === 'space'
      ? props.spaceId
      : props.projectId,
);

const fill = (c: AiConnectionView | null) => {
  own.value = c;
  if (!c) return;
  Object.assign(f, {
    provider: c.provider,
    baseUrl: c.baseUrl ?? '',
    apiKey: '',
    model: c.model,
    priceIn: c.priceIn ?? '',
    priceOut: c.priceOut ?? '',
  });
};
async function load() {
  const q = new URLSearchParams({ scope: props.level });
  if (scopeId.value) q.set('scopeId', scopeId.value);
  const r = await call<{ connection: AiConnectionView | null; effective: AiConnectionView | null }>(
    'GET',
    `connections?${q}`,
  );
  fill(r.connection);
  effective.value = r.effective;
}
const num = (v: string | number) => (v === '' ? null : Number(v));
async function save() {
  err.value = '';
  done.value = false;
  busy.value = true;
  try {
    const r = await call<{ connection: AiConnectionView }>('PUT', 'connections', {
      scope: props.level,
      scopeId: scopeId.value,
      provider: f.provider,
      baseUrl: f.baseUrl.trim() || null,
      apiKey: f.apiKey || undefined,
      model: f.model.trim(),
      priceIn: num(f.priceIn),
      priceOut: num(f.priceOut),
    });
    fill(r.connection);
    done.value = true;
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function remove() {
  err.value = '';
  try {
    await call('DELETE', `connections/${own.value!.id}`);
    own.value = null;
    f.apiKey = '';
    await load();
  } catch (e) {
    err.value = (e as Error).message;
  }
}
onMounted(() => load().catch((e) => (err.value = (e as Error).message)));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="ai-settings">
    <h2 class="text-lg font-semibold">{{ tr('title') }}</h2>
    <p class="text-sm text-fg-muted">{{ tr('intro') }}</p>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="ai-error">{{ err }}</p>
    <p v-if="!own && effective" class="text-sm" data-testid="ai-effective">
      {{ tr('inherited') }} {{ tr(effective.scope) }}: {{ effective.provider }},
      {{ effective.model }}
    </p>
    <h3 class="font-medium">{{ tr('own') }}</h3>
    <p v-if="!own" class="text-sm text-fg-muted">{{ tr('none') }}</p>
    <form class="flex flex-col gap-2" data-testid="ai-form" @submit.prevent="save">
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('provider') }}
        <select
          v-model="f.provider"
          data-testid="ai-provider"
          class="rounded-md border border-border bg-bg px-2 py-1"
        >
          <option v-for="p in AI_PROVIDERS" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('baseUrl') }}
        <input
          v-model="f.baseUrl"
          type="url"
          maxlength="2000"
          :required="f.provider === 'openai-compatible'"
          :placeholder="tr('baseUrlHint')"
          data-testid="ai-base-url"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('key') }}
        <input
          v-model="f.apiKey"
          type="password"
          autocomplete="off"
          maxlength="500"
          :required="!own"
          :placeholder="own ? tr('newKey') : ''"
          data-testid="ai-key"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
        <span v-if="own" class="text-xs text-fg-muted">{{ tr('keySet') }}</span>
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('model') }}
        <input
          v-model="f.model"
          required
          maxlength="200"
          data-testid="ai-model"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <div class="flex flex-wrap gap-2">
        <label class="flex flex-1 flex-col gap-1 text-sm"
          >{{ tr('priceIn') }}
          <input
            v-model="f.priceIn"
            type="number"
            min="0"
            step="any"
            data-testid="ai-price-in"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
        <label class="flex flex-1 flex-col gap-1 text-sm"
          >{{ tr('priceOut') }}
          <input
            v-model="f.priceOut"
            type="number"
            min="0"
            step="any"
            data-testid="ai-price-out"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="busy"
          data-testid="ai-save"
          class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
        >
          {{ tr(busy ? 'saving' : 'save') }}
        </button>
        <span v-if="done" class="text-sm text-fg-muted" data-testid="ai-saved">{{
          tr('saved')
        }}</span>
        <button v-if="own" type="button" class="underline" data-testid="ai-remove" @click="remove">
          {{ tr('remove') }}
        </button>
      </div>
    </form>
    <PacksSection v-if="level === 'project' && projectId" :project-id="projectId" />
  </section>
</template>
