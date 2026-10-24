<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Button, EmptyState, Select } from '@planar/web/modules';
import type { ImportJob, Preview } from '../shared/index.js';
import { getJob, previewFile, startJob, tr, useProjects, useStatuses } from './data';
import { FIELDS, buildMapping, guessStatus, presetsFor, statusValues } from './lib';

const step = ref<1 | 2 | 3>(1);
const file = ref<File | null>(null);
const format = ref<'csv' | 'trello'>('csv');
const preset = ref<string>('clickup');
const projectId = ref('');
const err = ref('');
const busy = ref(false);
const pv = ref<Preview | null>(null);
const map = ref<Record<string, string>>({});
const chosen = ref<Record<string, string>>({});
const job = ref<ImportJob | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

const projects = useProjects();
const allStatuses = useStatuses();
const spaceId = computed(() => projects.value?.find((p) => p.id === projectId.value)?.spaceId);
const statuses = computed(() =>
  (allStatuses.value ?? [])
    .filter((s) => s.spaceId === spaceId.value)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
const values = computed(() =>
  pv.value ? statusValues(pv.value.columns, pv.value.rows, map.value.status) : [],
);
const presets = computed(() => presetsFor(format.value));
// Reka Select не принимает пустое значение: «нет» — служебная метка
const NONE = '__none';
const colOptions = computed(() => [
  { value: NONE, label: tr('none') },
  ...(pv.value?.columns ?? []).map((c) => ({ value: c, label: c })),
]);
const statusOptions = computed(() => [
  { value: NONE, label: tr('byDefault') },
  ...statuses.value.map((s) => ({ value: s.id, label: s.name })),
]);
const setMap = (f: string, v: string | null) => {
  map.value[f] = !v || v === NONE ? '' : v;
  if (f === 'status') onStatusColumn();
};

function setFormat(f: 'csv' | 'trello') {
  format.value = f;
  preset.value = presetsFor(f)[0]!;
}
async function guard(fn: () => Promise<void>) {
  err.value = '';
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
const toPreview = () =>
  guard(async () => {
    pv.value = await previewFile(file.value!, format.value, preset.value);
    map.value = { ...pv.value.mapping } as unknown as Record<string, string>;
    chosen.value = {};
    step.value = 2;
  });
function onStatusColumn() {
  chosen.value = Object.fromEntries(values.value.map((v) => [v, guessStatus(v, statuses.value)]));
}
const run = () =>
  guard(async () => {
    job.value = await startJob(file.value!, {
      projectId: projectId.value,
      format: format.value,
      preset: preset.value,
      mapping: buildMapping(map.value, chosen.value),
    });
    step.value = 3;
    timer = setInterval(async () => {
      try {
        job.value = await getJob(job.value!.id);
        if (job.value.status === 'done' || job.value.status === 'failed') clearInterval(timer);
      } catch {
        /* следующий опрос повторит */
      }
    }, 1500);
  });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="import-page max-w-[960px] p-4">
    <header class="mb-3 flex flex-col gap-0.5">
      <h1 class="text-lg font-semibold">{{ tr('title') }}</h1>
    </header>
    <p v-if="err" role="alert" class="import-err text-sm text-danger">{{ err }}</p>

    <section v-if="step === 1" class="flex flex-col gap-3">
      <EmptyState v-if="!file" :title="tr('file')" />
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('file') }}
        <input
          type="file"
          accept=".csv,.json"
          @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null"
      /></label>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        {{ tr('format') }}
        <Select
          :model-value="format"
          :label="tr('format')"
          :options="[
            { value: 'csv', label: 'CSV' },
            { value: 'trello', label: 'Trello JSON' },
          ]"
          @update:model-value="(v) => v && setFormat(v as 'csv' | 'trello')"
        />
        {{ tr('preset') }}
        <Select
          v-model="preset"
          :label="tr('preset')"
          :options="presets.map((p) => ({ value: p, label: p }))"
        />
      </div>
      <div>
        <Button
          variant="primary"
          class="import-next"
          :disabled="!file || busy"
          :loading="busy"
          @click="toPreview"
        >
          {{ tr('next') }}
        </Button>
      </div>
    </section>

    <section v-else-if="step === 2 && pv" class="flex flex-col gap-3">
      <div class="import-project flex items-center gap-2 text-sm">
        {{ tr('project') }}
        <Select
          v-model="projectId"
          :label="tr('project')"
          placeholder="—"
          :options="(projects ?? []).map((p) => ({ value: p.id, label: p.name }))"
        />
      </div>
      <h2 v-if="format === 'csv'" class="font-medium">{{ tr('mapping') }}</h2>
      <div v-if="format === 'csv'" class="flex flex-col gap-1">
        <div v-for="f in FIELDS" :key="f" class="import-map flex items-center gap-2 text-sm">
          <span class="w-28">{{ f }}</span>
          <div :data-field="f">
            <Select
              :model-value="map[f] || NONE"
              :label="f"
              :options="colOptions"
              @update:model-value="(v) => setMap(f, v)"
            />
          </div>
        </div>
      </div>
      <div v-if="values.length" class="flex flex-col gap-1">
        <h2 class="font-medium">{{ tr('statuses') }}</h2>
        <div v-for="v in values" :key="v" class="import-status flex items-center gap-2 text-sm">
          <span class="w-28">{{ v }}</span>
          <Select
            :model-value="chosen[v] || NONE"
            :label="v"
            :options="statusOptions"
            @update:model-value="(x) => (chosen[v] = !x || x === NONE ? '' : x)"
          />
        </div>
      </div>
      <h2 class="font-medium">{{ tr('preview') }}</h2>
      <div class="overflow-x-auto">
        <table class="import-preview text-sm">
          <thead>
            <tr>
              <th v-for="c in pv.columns" :key="c" class="px-2 text-left">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in pv.rows" :key="i">
              <td v-for="(c, j) in r" :key="j" class="px-2">{{ c }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex gap-2">
        <Button @click="step = 1">{{ tr('back') }}</Button>
        <Button
          variant="primary"
          class="import-start"
          :disabled="!projectId || !map.title || busy"
          @click="run"
        >
          {{ tr('start') }}
        </Button>
      </div>
    </section>

    <section v-else-if="job" class="flex flex-col gap-2">
      <p class="import-status-line">
        {{
          job.status === 'done'
            ? tr('done')
            : job.status === 'failed'
              ? tr('failed')
              : tr('progress')
        }}: {{ job.processed }} / {{ job.total }}
      </p>
      <progress :value="job.processed" :max="job.total || 1" />
      <p>
        {{ tr('created') }}: {{ job.created }} · {{ tr('updated') }}: {{ job.updated }} ·
        {{ tr('skipped') }}: {{ job.skipped.length }}
      </p>
      <p v-if="job.error" role="alert">{{ job.error }}</p>
      <h2 v-if="job.skipped.length" class="font-medium">{{ tr('skipped') }}</h2>
      <ul class="import-skipped text-sm">
        <li v-for="s in job.skipped" :key="s.row">{{ tr('row') }} {{ s.row }}: {{ s.reason }}</li>
      </ul>
      <h2 v-if="job.warnings.length" class="font-medium">{{ tr('warnings') }}</h2>
      <ul class="import-warnings text-sm">
        <li v-for="s in job.warnings" :key="s.row + s.message">
          {{ tr('row') }} {{ s.row }}: {{ s.message }}
        </li>
      </ul>
      <div>
        <Button
          v-if="job.status === 'done' || job.status === 'failed'"
          @click="
            step = 1;
            job = null;
          "
        >
          {{ tr('again') }}
        </Button>
      </div>
    </section>
  </div>
</template>
