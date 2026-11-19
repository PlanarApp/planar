<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Button } from '@planar/web/modules';
import type { HarnessOp } from '../shared/index.js';
import { AiApiError, call } from './api';
import { tr } from './data';
import { buildReplaceWith, groupOps, needReplace, replaceTargets } from './harnessUi';

// The diff of a pack against the project → «Apply» (admin of the project; the API answers 403 otherwise).
// Shared by the pack document panel (HarnessPanel) and the packs section after an upload (PLNRAPP-538).
const props = defineProps<{ projectId: string; packPageId: string }>();
const emit = defineEmits<{ applied: [] }>();

const diff = ref<{ ops: HarnessOp[]; errors: string[] } | null>(null);
const picked = reactive<Record<string, string>>({});
const error = ref('');
const busy = ref(false);

const body = () => ({
  projectId: props.projectId,
  packPageId: props.packPageId,
  replaceWith: buildReplaceWith(picked),
});
const failure = (e: unknown) =>
  e instanceof AiApiError && e.status === 403
    ? tr('forbidden')
    : e instanceof AiApiError && e.status === 409
      ? tr('changed')
      : (e as Error).message;

async function load() {
  try {
    diff.value = await call('POST', 'harness/diff', body());
  } catch (e) {
    error.value = failure(e);
  }
}
async function apply() {
  busy.value = true;
  error.value = '';
  try {
    await call('POST', 'harness/apply', body());
    emit('applied');
  } catch (e) {
    error.value = failure(e);
    if (e instanceof AiApiError && e.status === 409) await load();
  } finally {
    busy.value = false;
  }
}
const groups = computed(() => groupOps(diff.value?.ops ?? []));
const needs = computed(() => needReplace(diff.value?.errors ?? []));
const targets = computed(() => replaceTargets(diff.value?.ops ?? []));
onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="harness-diff">
    <p v-if="!diff && !error" class="text-fg-muted">…</p>
    <template v-if="diff">
      <p v-if="!diff.ops.length && !diff.errors.length" class="text-fg-muted">
        {{ tr('noChanges') }}
      </p>
      <section v-for="g in groups" :key="g.kind" class="flex flex-col gap-1">
        <h3 class="font-medium">{{ tr(g.kind) }}</h3>
        <ul class="text-sm" data-testid="harness-ops">
          <li v-for="o in g.ops" :key="o.op + o.key">
            <span class="mr-2 rounded bg-bg-muted px-1.5 text-xs">{{ tr(o.op) }}</span
            >{{ o.key }}
          </li>
        </ul>
      </section>
      <ul v-if="diff.errors.length" class="text-sm text-danger" data-testid="harness-errors">
        <li v-for="e in diff.errors" :key="e" role="alert">{{ e }}</li>
      </ul>
      <label v-for="k in needs" :key="k" class="flex flex-col gap-1 text-sm">
        {{ tr('moveTasks') }} «{{ k }}»
        <input
          v-model="picked[k]"
          :list="`harness-targets-${k}`"
          data-testid="harness-replace"
          class="rounded-md border border-border bg-bg px-2 py-1"
          @change="load()"
        />
        <datalist :id="`harness-targets-${k}`">
          <option v-for="t in targets" :key="t" :value="t" />
        </datalist>
      </label>
    </template>
    <p v-if="error" role="alert" class="text-sm text-danger" data-testid="harness-error">
      {{ error }}
    </p>
    <div class="flex justify-end">
      <Button
        :disabled="!diff || !!diff.errors.length || !diff.ops.length || busy"
        data-testid="harness-confirm"
        @click="apply"
      >
        {{ tr('apply') }}
      </Button>
    </div>
  </div>
</template>
