<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Button } from '@planar/web/modules';
import { AI_PROVIDERS, type AiConnectionView, type HarnessOp } from '../shared/index.js';
import { AiApiError, call } from './api';
import ConnectionFields from './ConnectionFields.vue';
import { tr } from './data';
import { applyFailure, diffPrefix, hasChanges, type ChatReply, type Proposal } from './docChatUi';
import { buildReplaceWith, groupOps, needReplace, replaceTargets } from './harnessUi';
import PackConflicts from './PackConflicts.vue';
import { usePackUpload } from './usePackUpload';
import { canAdvance, nextStep, prevStep, type WizardStep } from './wizardUi';

// «Settings → AI → Setup wizard» (project level): key → template + prompt → pack (+ AI adaptation) → harness diff → apply.
// Only the existing API; `reinit` starts from the template step (the connection is already there) and the upload asks per page.
const props = defineProps<{ projectId: string; reinit?: boolean }>();
const emit = defineEmits<{ close: [] }>();
type Pack = { packKey: string; active: boolean; rootPageId: string | null };

const step = ref<WizardStep>('key');
const connected = ref(false);
const err = ref('');
const busy = ref(false);
const finished = ref(false);
const f = reactive({
  provider: 'openai' as (typeof AI_PROVIDERS)[number],
  baseUrl: '',
  apiKey: '',
  model: '',
});
const catalog = ref<{ key: string; title: string }[]>([]);
const packs = ref<Pack[]>([]);
const packKey = ref('');
const prompt = ref(tr('wzPromptDefault'));
const uploaded = ref(false);

const failure = (e: unknown) =>
  e instanceof AiApiError && e.status === 403
    ? tr('forbidden')
    : e instanceof AiApiError && e.status === 409
      ? tr('changed')
      : (e as Error).message;
async function guard(fn: () => Promise<void>) {
  err.value = '';
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    err.value = failure(e);
  } finally {
    busy.value = false;
  }
}

// step 1: PUT /connections checks the key against the provider before it saves (502 → the message is shown)
// the project's own connection (its key serves the models list); `effective` comes only without it
const saved = ref<AiConnectionView | null>(null);
async function loadConnection() {
  const q = new URLSearchParams({ scope: 'project', scopeId: props.projectId });
  const r = await call<{ connection: AiConnectionView | null; effective: AiConnectionView | null }>(
    'GET',
    `connections?${q}`,
  );
  saved.value = r.connection;
  const c = r.connection ?? r.effective;
  connected.value = !!c;
  if (c) Object.assign(f, { provider: c.provider, baseUrl: c.baseUrl ?? '', model: c.model });
}
const saveKey = () =>
  guard(async () => {
    await call('PUT', 'connections', {
      scope: 'project',
      scopeId: props.projectId,
      provider: f.provider,
      baseUrl: f.baseUrl.trim() || null,
      apiKey: f.apiKey || undefined,
      model: f.model.trim(),
    });
    f.apiKey = '';
    await loadConnection();
  });

// step 3: upload with per-page conflict choice (shared with PacksSection)
async function loadPacks() {
  const r = await call<{ catalog: typeof catalog.value; packs: Pack[] }>(
    'GET',
    `packs?${new URLSearchParams({ projectId: props.projectId })}`,
  );
  catalog.value = r.catalog;
  packs.value = r.packs;
  packKey.value ||= r.catalog[0]?.key ?? '';
}
const u = usePackUpload(props.projectId, guard, async () => {
  await loadPacks();
  uploaded.value = !u.pending.value;
});
const rootPageId = computed(
  () => packs.value.find((p) => p.packKey === packKey.value)?.rootPageId ?? null,
);

const proposal = ref<Proposal | null>(null);
const adapted = ref<'' | 'applied' | 'none'>('');
const stale = ref(false);
const adapt = () =>
  guard(async () => {
    adapted.value = '';
    const r = await call<ChatReply>('POST', 'doc-chat', {
      pageId: rootPageId.value,
      message: prompt.value,
      history: [],
    });
    proposal.value = hasChanges(r.proposal) ? r.proposal : null;
    if (!proposal.value) adapted.value = 'none';
  });
async function accept() {
  const p = proposal.value!;
  await guard(async () => {
    try {
      await call('POST', 'doc-chat/apply', {
        pageId: rootPageId.value,
        body: p.body,
        baseUpdatedAt: p.baseUpdatedAt,
      });
    } catch (e) {
      if (applyFailure(e instanceof AiApiError ? e.status : undefined) === 'changed') {
        stale.value = true;
        throw new Error(tr('docChanged'));
      }
      throw e;
    }
    proposal.value = null;
    stale.value = false;
    adapted.value = 'applied';
  });
}
const cls = (t: string) =>
  t === 'add' ? 'bg-success/10' : t === 'del' ? 'bg-danger/10 line-through' : 'text-fg-muted';

// step 4: the same diff → apply as the pack document panel (HarnessPanel)
const diff = ref<{ ops: HarnessOp[]; errors: string[] } | null>(null);
const picked = reactive<Record<string, string>>({});
const hbody = () => ({
  projectId: props.projectId,
  packPageId: rootPageId.value,
  replaceWith: buildReplaceWith(picked),
});
const loadDiff = () =>
  guard(async () => {
    diff.value = await call('POST', 'harness/diff', hbody());
  });
const applyHarness = () =>
  guard(async () => {
    try {
      await call('POST', 'harness/apply', hbody());
    } catch (e) {
      if (e instanceof AiApiError && e.status === 409) diff.value = null;
      throw e;
    }
    finished.value = true;
  });
const groups = computed(() => groupOps(diff.value?.ops ?? []));
const needs = computed(() => needReplace(diff.value?.errors ?? []));
const targets = computed(() => replaceTargets(diff.value?.ops ?? []));

const state = computed(() => ({
  connected: connected.value,
  packKey: packKey.value,
  prompt: prompt.value,
  uploaded: uploaded.value,
}));
async function go(to: WizardStep) {
  err.value = '';
  step.value = to;
  if (to === 'harness') await loadDiff();
}
const labels = {
  key: 'wzKey',
  template: 'wzTemplate',
  pack: 'wzPack',
  harness: 'wzHarness',
} as const;
onMounted(() =>
  guard(async () => {
    await Promise.all([loadConnection(), loadPacks()]);
    if (props.reinit && connected.value) step.value = 'template';
  }),
);
</script>

<template>
  <div class="flex flex-col gap-3 rounded-md border border-border p-3" data-testid="wizard">
    <ol class="flex flex-wrap gap-3 text-sm">
      <li
        v-for="s in ['key', 'template', 'pack', 'harness'] as const"
        :key="s"
        :class="s === step ? 'font-semibold' : 'text-fg-muted'"
      >
        {{ tr(labels[s]) }}
      </li>
    </ol>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="wizard-error">{{ err }}</p>
    <p v-if="finished" class="text-sm" data-testid="wizard-done">{{ tr('wzDone') }}</p>

    <form
      v-else-if="step === 'key'"
      class="flex flex-col gap-2 text-sm"
      data-testid="wizard-key"
      @submit.prevent="saveKey"
    >
      <p v-if="connected" class="text-fg-muted" data-testid="wizard-connected">
        {{ tr('wzConnected') }}
      </p>
      <ConnectionFields :f="f" scope="project" :scope-id="projectId" :saved="saved">
        <label class="flex flex-col gap-1"
          >{{ tr('key') }}
          <input
            v-model="f.apiKey"
            type="password"
            autocomplete="off"
            maxlength="500"
            :required="!saved"
            :placeholder="saved ? tr('newKey') : ''"
            data-testid="wizard-key-input"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
      </ConnectionFields>
      <div>
        <Button type="submit" size="sm" :disabled="busy" data-testid="wizard-check">{{
          tr(busy ? 'saving' : 'save')
        }}</Button>
      </div>
    </form>

    <div v-else-if="step === 'template'" class="flex flex-col gap-2 text-sm">
      <label class="flex flex-col gap-1"
        >{{ tr('wzTemplatePick') }}
        <select
          v-model="packKey"
          data-testid="wizard-template"
          @change="uploaded = false"
          class="rounded-md border border-border bg-bg px-2 py-1"
        >
          <option v-for="c in catalog" :key="c.key" :value="c.key">{{ c.title }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1"
        >{{ tr('wzPrompt') }}
        <textarea
          v-model="prompt"
          rows="5"
          data-testid="wizard-prompt"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
    </div>

    <div v-else-if="step === 'pack'" class="flex flex-col gap-2 text-sm">
      <div v-if="reinit" class="text-fg-muted">{{ tr('reinitHint') }}</div>
      <div class="flex flex-wrap gap-2">
        <Button
          size="sm"
          :disabled="busy"
          data-testid="wizard-upload"
          @click="u.upload({ packKey })"
          >{{ tr('wzUpload') }}</Button
        >
        <Button
          v-if="uploaded"
          size="sm"
          :disabled="busy"
          data-testid="wizard-adapt"
          @click="adapt"
          >{{ tr('wzAdapt') }}</Button
        >
      </div>
      <PackConflicts :u="u" :busy="busy" />
      <p v-if="adapted === 'none'" class="text-fg-muted">{{ tr('wzNoProposal') }}</p>
      <p v-if="adapted === 'applied'" class="text-fg-muted" data-testid="wizard-adapted">
        {{ tr('accepted') }}
      </p>
      <template v-if="proposal">
        <div
          class="max-h-80 overflow-auto rounded-md border border-border p-2 font-mono text-xs"
          data-testid="wizard-diff"
        >
          <div
            v-for="(l, i) in proposal.diff"
            :key="i"
            :class="['whitespace-pre-wrap', cls(l.type)]"
          >
            {{ diffPrefix(l.type) }} {{ l.text }}
          </div>
        </div>
        <div class="flex gap-2">
          <Button size="sm" :disabled="busy || stale" data-testid="wizard-accept" @click="accept">{{
            tr('accept')
          }}</Button>
          <Button size="sm" @click="proposal = null">{{ tr('reject') }}</Button>
          <Button v-if="stale" size="sm" @click="adapt">{{ tr('reRequest') }}</Button>
        </div>
      </template>
    </div>

    <div v-else class="flex flex-col gap-2 text-sm">
      <p v-if="!diff && !err" class="text-fg-muted">…</p>
      <template v-if="diff">
        <p v-if="!diff.ops.length && !diff.errors.length" class="text-fg-muted">
          {{ tr('noChanges') }}
        </p>
        <section v-for="g in groups" :key="g.kind" class="flex flex-col gap-1">
          <h4 class="font-medium">{{ tr(g.kind) }}</h4>
          <ul data-testid="wizard-ops">
            <li v-for="o in g.ops" :key="o.op + o.key">
              <span class="mr-2 rounded bg-bg-muted px-1.5 text-xs">{{ tr(o.op) }}</span
              >{{ o.key }}
            </li>
          </ul>
        </section>
        <ul v-if="diff.errors.length" class="text-danger">
          <li v-for="e in diff.errors" :key="e" role="alert">{{ e }}</li>
        </ul>
        <label v-for="k in needs" :key="k" class="flex flex-col gap-1">
          {{ tr('moveTasks') }} «{{ k }}»
          <input
            v-model="picked[k]"
            :list="`wizard-targets-${k}`"
            class="rounded-md border border-border bg-bg px-2 py-1"
            @change="loadDiff()"
          />
          <datalist :id="`wizard-targets-${k}`">
            <option v-for="t in targets" :key="t" :value="t" />
          </datalist>
        </label>
      </template>
    </div>

    <div class="flex flex-wrap gap-2">
      <template v-if="!finished">
        <Button v-if="step !== 'key'" size="sm" :disabled="busy" @click="go(prevStep(step))">{{
          tr('wzBack')
        }}</Button>
        <Button
          v-if="step !== 'harness'"
          size="sm"
          :disabled="busy || !canAdvance(step, state)"
          data-testid="wizard-next"
          @click="go(nextStep(step))"
          >{{ tr('wzNext') }}</Button
        >
        <Button
          v-else
          size="sm"
          :disabled="busy || !diff || !!diff.errors.length || !diff.ops.length"
          data-testid="wizard-apply"
          @click="applyHarness"
          >{{ tr('apply') }}</Button
        >
      </template>
      <Button size="sm" data-testid="wizard-close" @click="emit('close')">{{
        tr('wzClose')
      }}</Button>
    </div>
  </div>
</template>
