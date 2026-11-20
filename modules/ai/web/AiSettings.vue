<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue';
import { Tabs, useProjectAdmin, useRouter } from '@planar/web/modules';
import { AI_PROVIDERS, type AiConnectionView } from '../shared/index.js';
import { call } from './api';
import ConnectionFields from './ConnectionFields.vue';
import { tr } from './data';
import EgressSection from './EgressSection.vue';
import LimitsSection from './LimitsSection.vue';
import PacksSection from './PacksSection.vue';
import SetupWizard from './SetupWizard.vue';

// «Settings → AI»: the connection of one level; the key is only sent, never shown
const props = defineProps<{
  level: 'workspace' | 'space' | 'project';
  spaceId?: string;
  projectId?: string;
}>();
// PLNRAPP-538: the project page in tabs (the connection and its sections; packs and rules);
// PLNRAPP-568: the workspace page (its admin only) — the connection, AI tasks, the engines monitor; space — no tabs;
// PLNRAPP-569: the project page — also AI tasks and the engines monitor of this project (its admin or a workspace admin)
const projectAdmin = useProjectAdmin();
const canMonitor = computed(
  () => !!props.projectId && !!props.spaceId && projectAdmin(props.spaceId, props.projectId),
);
const tabs = computed(() =>
  props.level === 'project'
    ? [
        { value: 'connection', label: tr('tabConnection') },
        { value: 'packs', label: tr('tabPacks') },
        ...(canMonitor.value
          ? [
              { value: 'tasks', label: tr('tabTasks') },
              { value: 'engines', label: tr('tabEngines') },
            ]
          : []),
      ]
    : props.level === 'workspace'
      ? [
          { value: 'connection', label: tr('tabConnection') },
          { value: 'tasks', label: tr('tabTasks') },
          { value: 'engines', label: tr('tabEngines') },
        ]
      : [],
);
const AiMonitor = defineAsyncComponent(() => import('./AiMonitor.vue').then((m) => m.default));
const EnginesTab = defineAsyncComponent(() => import('./EnginesTab.vue').then((m) => m.default));
// the tab is in the address (?tab=…): links lead to it (aikb «AI tasks» → ?s=ai:workspace&tab=tasks)
const router = useRouter();
const fromQuery = () => {
  const q = router.currentRoute.value.query.tab;
  return tabs.value.some((t) => t.value === q) ? (q as string) : 'connection';
};
const tab = ref(fromQuery());
watch(tab, (v) => {
  const query = { ...router.currentRoute.value.query };
  if (v === 'connection') delete query.tab;
  else query.tab = v;
  void router.replace({ query });
});
watch(
  () => router.currentRoute.value.query.tab,
  () => (tab.value = fromQuery()),
);
// the admin rights come from the replica a moment later: the tab of the address opens then
watch(canMonitor, () => (tab.value = fromQuery()));
const own = ref<AiConnectionView | null>(null);
const effective = ref<AiConnectionView | null>(null);
const err = ref('');
const done = ref(false);
const busy = ref(false);
// the wizard (project level); closing it reloads the packs list and the connection
const wizard = ref<'setup' | 'reinit' | null>(null);
const wizardRuns = ref(0);
const closeWizard = () => {
  wizard.value = null;
  wizardRuns.value++;
  load().catch((e) => (err.value = (e as Error).message));
};
const f = reactive({
  provider: 'openai' as (typeof AI_PROVIDERS)[number],
  baseUrl: '',
  apiKey: '',
  model: '',
  priceIn: '',
  priceOut: '',
});

const scopeId = computed(() =>
  props.level === 'workspace'
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
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="ai-error">{{ err }}</p>
    <Tabs v-if="tabs.length" v-model="tab" :label="tr('title')" :items="tabs" />
    <div v-show="tab === 'connection'" class="flex flex-col gap-4">
      <p class="text-sm text-fg-muted">{{ tr('intro') }}</p>
      <p v-if="!own && effective" class="text-sm" data-testid="ai-effective">
        {{ tr('inherited') }} {{ tr(effective.scope) }}: {{ effective.provider }},
        {{ effective.model }}
      </p>
      <h3 class="font-medium">{{ tr('own') }}</h3>
      <p v-if="!own" class="text-sm text-fg-muted">{{ tr('none') }}</p>
      <form class="flex flex-col gap-2" data-testid="ai-form" @submit.prevent="save">
        <ConnectionFields :f="f" :scope="level" :scope-id="scopeId" :saved="own">
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
        </ConnectionFields>
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
          <button
            v-if="own"
            type="button"
            class="underline"
            data-testid="ai-remove"
            @click="remove"
          >
            {{ tr('remove') }}
          </button>
        </div>
      </form>
      <EgressSection v-if="level === 'workspace'" />
      <template v-if="level === 'project' && projectId">
        <div class="flex flex-wrap items-center gap-3" data-testid="wizard-buttons">
          <button
            type="button"
            class="rounded-md border border-border px-3 py-1"
            data-testid="wizard-open"
            @click="wizard = 'setup'"
          >
            {{ tr('wizard') }}
          </button>
          <button
            type="button"
            class="rounded-md border border-border px-3 py-1"
            data-testid="wizard-reinit"
            @click="wizard = 'reinit'"
          >
            {{ tr('reinit') }}
          </button>
        </div>
        <SetupWizard
          v-if="wizard"
          :key="wizardRuns"
          :project-id="projectId"
          :reinit="wizard === 'reinit'"
          @close="closeWizard"
        />
        <LimitsSection :project-id="projectId" />
      </template>
    </div>
    <PacksSection v-if="tab === 'packs' && projectId" :key="wizardRuns" :project-id="projectId" />
    <AiMonitor v-if="level === 'workspace' && tab === 'tasks'" />
    <EnginesTab v-if="level === 'workspace' && tab === 'engines'" />
    <template v-if="level === 'project' && projectId && canMonitor">
      <AiMonitor v-if="tab === 'tasks'" :project-id="projectId" />
      <EnginesTab v-if="tab === 'engines'" :project-id="projectId" />
    </template>
  </section>
</template>
