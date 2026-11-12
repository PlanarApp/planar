<script setup lang="ts">
import { ref, useId, watch } from 'vue';
import { AI_PRESETS, AI_PROVIDERS, type AiProvider } from '../shared/index.js';
import { call } from './api';
import { tr } from './data';

// PLNRAPP-189: provider (a ready one fills provider + baseUrl, «custom» shows both), the key (slot), the model
// from the provider's list. The list is asked with the typed key or, for the same provider and URL, the saved one.
const props = defineProps<{
  f: { provider: AiProvider; baseUrl: string; apiKey: string; model: string };
  scope: 'instance' | 'space' | 'project';
  scopeId?: string;
  /** the level's own saved connection: its key serves the list while no new key is typed */
  saved: { provider: AiProvider; baseUrl: string | null } | null;
}>();

const presetOf = (provider: string, baseUrl: string) =>
  AI_PRESETS.find((p) => p.provider === provider && (p.baseUrl ?? '') === baseUrl)?.id ?? 'custom';
const preset = ref(presetOf(props.f.provider, props.f.baseUrl));
// a connection loaded by the parent; «custom» stays while its fields are edited
watch(
  () => [props.f.provider, props.f.baseUrl],
  () => {
    if (preset.value !== 'custom') preset.value = presetOf(props.f.provider, props.f.baseUrl);
  },
);
const pickPreset = () => {
  const p = AI_PRESETS.find((x) => x.id === preset.value);
  if (p) Object.assign(props.f, { provider: p.provider, baseUrl: p.baseUrl ?? '' });
};

const listId = useId();
const models = ref<string[]>([]);
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
watch(
  () => [props.f.provider, props.f.baseUrl, props.f.apiKey, props.saved],
  () => {
    clearTimeout(timer);
    const my = ++seq;
    models.value = [];
    failed.value = false;
    const { f, saved } = props;
    const key =
      f.apiKey || (saved && saved.provider === f.provider && (saved.baseUrl ?? '') === f.baseUrl);
    if (!key || (f.provider === 'openai-compatible' && !f.baseUrl.trim())) return;
    timer = setTimeout(async () => {
      try {
        const r = await call<{ models: string[] }>('POST', 'connections/models', {
          scope: props.scope,
          scopeId: props.scopeId,
          provider: f.provider,
          baseUrl: f.baseUrl.trim() || null,
          apiKey: f.apiKey || undefined,
        });
        if (my === seq) models.value = r.models;
      } catch {
        if (my === seq) failed.value = true;
      }
    }, 500);
  },
  { immediate: true },
);
</script>

<template>
  <label class="flex flex-col gap-1 text-sm"
    >{{ tr('provider') }}
    <select
      v-model="preset"
      data-testid="ai-preset"
      class="rounded-md border border-border bg-bg px-2 py-1"
      @change="pickPreset"
    >
      <option v-for="p in AI_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
      <option value="custom">{{ tr('custom') }}</option>
    </select>
  </label>
  <template v-if="preset === 'custom'">
    <label class="flex flex-col gap-1 text-sm"
      >{{ tr('protocol') }}
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
  </template>
  <slot />
  <label class="flex flex-col gap-1 text-sm"
    >{{ tr('model') }}
    <input
      v-model="f.model"
      required
      maxlength="200"
      :list="listId"
      autocomplete="off"
      data-testid="ai-model"
      class="rounded-md border border-border bg-bg px-2 py-1"
    />
    <datalist :id="listId" data-testid="ai-models">
      <option v-for="m in models" :key="m" :value="m" />
    </datalist>
    <span class="text-xs text-fg-muted" data-testid="ai-models-hint">{{
      tr(failed ? 'modelsFailed' : models.length ? 'modelsPick' : 'modelsNeedKey')
    }}</span>
  </label>
</template>
