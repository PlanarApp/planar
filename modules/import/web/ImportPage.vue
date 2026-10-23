<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
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
  <div class="import-page" style="padding: 16px; max-width: 960px">
    <h1>{{ tr('title') }}</h1>
    <p v-if="err" role="alert" class="import-err">{{ err }}</p>

    <section v-if="step === 1">
      <label
        >{{ tr('file') }}
        <input
          type="file"
          accept=".csv,.json"
          @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null"
      /></label>
      <label
        >{{ tr('format') }}
        <select
          :value="format"
          @change="setFormat(($event.target as HTMLSelectElement).value as 'csv' | 'trello')"
        >
          <option value="csv">CSV</option>
          <option value="trello">Trello JSON</option>
        </select>
      </label>
      <label
        >{{ tr('preset') }}
        <select v-model="preset">
          <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <button class="import-next" :disabled="!file || busy" @click="toPreview">
        {{ tr('next') }}
      </button>
    </section>

    <section v-else-if="step === 2 && pv">
      <label
        >{{ tr('project') }}
        <select v-model="projectId" class="import-project">
          <option value="" disabled>—</option>
          <option v-for="p in projects ?? []" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <h2 v-if="format === 'csv'">{{ tr('mapping') }}</h2>
      <div v-if="format === 'csv'">
        <label v-for="f in FIELDS" :key="f" class="import-map">
          {{ f }}
          <select v-model="map[f]" :data-field="f" @change="f === 'status' && onStatusColumn()">
            <option value="">{{ tr('none') }}</option>
            <option v-for="c in pv.columns" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
      </div>
      <div v-if="values.length">
        <h2>{{ tr('statuses') }}</h2>
        <label v-for="v in values" :key="v" class="import-status">
          {{ v }}
          <select v-model="chosen[v]">
            <option value="">{{ tr('byDefault') }}</option>
            <option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
      </div>
      <h2>{{ tr('preview') }}</h2>
      <table class="import-preview">
        <thead>
          <tr>
            <th v-for="c in pv.columns" :key="c">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in pv.rows" :key="i">
            <td v-for="(c, j) in r" :key="j">{{ c }}</td>
          </tr>
        </tbody>
      </table>
      <button @click="step = 1">{{ tr('back') }}</button>
      <button class="import-start" :disabled="!projectId || !map.title || busy" @click="run">
        {{ tr('start') }}
      </button>
    </section>

    <section v-else-if="job">
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
      <h2 v-if="job.skipped.length">{{ tr('skipped') }}</h2>
      <ul class="import-skipped">
        <li v-for="s in job.skipped" :key="s.row">{{ tr('row') }} {{ s.row }}: {{ s.reason }}</li>
      </ul>
      <h2 v-if="job.warnings.length">{{ tr('warnings') }}</h2>
      <ul class="import-warnings">
        <li v-for="s in job.warnings" :key="s.row + s.message">
          {{ tr('row') }} {{ s.row }}: {{ s.message }}
        </li>
      </ul>
      <button
        v-if="job.status === 'done' || job.status === 'failed'"
        @click="
          step = 1;
          job = null;
        "
      >
        {{ tr('again') }}
      </button>
    </section>
  </div>
</template>
