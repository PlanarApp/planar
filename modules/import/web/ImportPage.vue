<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Button, EmptyState, Select } from '@planar/web/modules';
import { NEW, STATUS_CATEGORIES, type ImportJob, type Preview } from '../shared/index.js';
import {
  getJob,
  previewFile,
  startJob,
  tr,
  useProjects,
  useSession,
  useSpaces,
  useStatuses,
  useUsers,
  type Key,
} from './data';
import {
  FIELDS,
  VALUE_FIELDS,
  buildMapping,
  guessProject,
  guessStatus,
  guessUser,
  newStatus,
  presetsFor,
} from './lib';

const step = ref<1 | 2 | 3>(1);
const file = ref<File | null>(null);
const format = ref<'csv' | 'trello'>('csv');
const preset = ref<string>('clickup');
const spaceId = ref('');
const projectId = ref('');
const err = ref('');
const busy = ref(false);
const pv = ref<Preview | null>(null);
const map = ref<Record<string, string>>({});
const chosen = ref<Record<string, string>>({});
const projMap = ref<Record<string, string>>({});
const people = ref<Record<string, string>>({});
const job = ref<ImportJob | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

const spaces = useSpaces();
const projects = useProjects();
const users = useUsers();
const session = useSession();
const isAdmin = computed(() => ['owner', 'admin'].includes(session.value?.role ?? ''));
const allStatuses = useStatuses();
const statuses = computed(() =>
  (allStatuses.value ?? [])
    .filter((s) => s.projectId === projectId.value)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
const values = computed(() => (map.value.status ? (pv.value?.values.status ?? []) : []));
// the import goes into the chosen space: the main project and the projects of the file are from it
const spaceProjects = computed(() =>
  (projects.value ?? []).filter((p) => p.spaceId === spaceId.value && !p.archivedAt),
);
// without a project column the main project is required; with one — optional
const canStart = computed(
  () => !!spaceId.value && !!map.value.title && (!!projectId.value || !!map.value.project),
);
const mainOptions = computed(() => [
  ...(map.value.project ? [{ value: NONE, label: '—' }] : []),
  ...spaceProjects.value.map((p) => ({ value: p.id, label: p.name })),
]);
const fileProjects = computed(() => (map.value.project ? (pv.value?.values.project ?? []) : []));
const filePeople = computed(() =>
  map.value.assignee || map.value.comments ? (pv.value?.values.people ?? []) : [],
);
const activeUsers = computed(() => (users.value ?? []).filter((u) => !u.deactivatedAt));
const projectOptions = computed(() => [
  { value: NONE, label: tr(projectId.value ? 'mainProject' : 'skipRows') },
  { value: NEW, label: tr('createNew') },
  ...spaceProjects.value.map((p) => ({ value: p.id, label: `${p.name} (${p.key})` })),
]);
const personOptions = computed(() => [
  { value: NONE, label: tr('noMatch') },
  ...(isAdmin.value ? [{ value: NEW, label: tr('createNew') }] : []),
  ...activeUsers.value.map((u) => ({ value: u.id, label: `${u.name} (${u.login})` })),
]);
const presets = computed(() => presetsFor(format.value));
// Reka Select does not accept an empty value: «none» is a service label
const NONE = '__none';
const colOptions = computed(() => [
  { value: NONE, label: tr('none') },
  ...(pv.value?.columns ?? []).map((c) => ({ value: c, label: c })),
]);
const CREATE_LABEL: Record<(typeof STATUS_CATEGORIES)[number], Key> = {
  backlog: 'createBacklog',
  todo: 'createTodo',
  in_progress: 'createInProgress',
  done: 'createDone',
  cancelled: 'createCancelled',
};
const statusOptions = computed(() => [
  { value: NONE, label: tr('byDefault') },
  ...STATUS_CATEGORIES.map((c) => ({ value: newStatus(c), label: tr(CREATE_LABEL[c]) })),
  ...statuses.value.map((s) => ({ value: s.id, label: s.name })),
]);
const setMap = (f: string, v: string | null) => {
  map.value[f] = !v || v === NONE ? '' : v;
  if (VALUE_FIELDS.includes(f)) void refreshValues();
};
// values over the whole file by the current columns: the server re-reads the file
const refreshValues = () =>
  guard(async () => {
    if (!map.value.title) return;
    const p = await previewFile(
      file.value!,
      format.value,
      preset.value,
      buildMapping(map.value, {}),
    );
    pv.value = { ...pv.value!, values: p.values };
    guessAll();
  });
// hints for values without a choice yet; a choice made by hand stays
function guessAll() {
  for (const v of values.value) chosen.value[v] ??= guessStatus(v, statuses.value);
  for (const v of fileProjects.value)
    projMap.value[v.name] ??= guessProject(v, spaceProjects.value);
  for (const n of filePeople.value)
    people.value[n] ??= guessUser(n, activeUsers.value, isAdmin.value);
}

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
    projMap.value = {};
    people.value = {};
    guessAll();
    step.value = 2;
  });
// hints depend on the space (its projects) and the main project (its statuses)
function setSpace(id: string) {
  spaceId.value = id;
  projectId.value = '';
  chosen.value = {};
  projMap.value = {};
  guessAll();
}
function setProject(id: string) {
  projectId.value = id;
  chosen.value = {};
  guessAll();
}
const run = () =>
  guard(async () => {
    job.value = await startJob(file.value!, {
      spaceId: spaceId.value,
      projectId: projectId.value,
      format: format.value,
      preset: preset.value,
      mapping: buildMapping(map.value, chosen.value, {
        projects: projMap.value,
        people: people.value,
      }),
    });
    step.value = 3;
    timer = setInterval(async () => {
      try {
        job.value = await getJob(job.value!.id);
        if (job.value.status === 'done' || job.value.status === 'failed') clearInterval(timer);
      } catch {
        /* the next poll will repeat */
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
            { value: 'csv', label: 'CSV / JSON' },
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
      <div class="import-space flex items-center gap-2 text-sm">
        {{ tr('space') }}
        <Select
          :model-value="spaceId"
          :label="tr('space')"
          placeholder="—"
          :options="(spaces ?? []).map((s) => ({ value: s.id, label: s.name }))"
          @update:model-value="(v) => v && setSpace(v)"
        />
      </div>
      <div v-if="spaceId" class="import-project flex items-center gap-2 text-sm">
        {{ map.project ? tr('projectOptional') : tr('project') }}
        <Select
          :model-value="projectId || NONE"
          :label="tr('project')"
          placeholder="—"
          :options="mainOptions"
          @update:model-value="(v) => setProject(!v || v === NONE ? '' : v)"
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
      <div v-if="fileProjects.length && spaceId" class="flex flex-col gap-1">
        <h2 class="font-medium">{{ tr('projects') }}</h2>
        <div
          v-for="p in fileProjects"
          :key="p.name"
          class="import-file-project flex items-center gap-2 text-sm"
        >
          <span class="w-48">{{ p.name }}{{ p.key ? ` (${p.key})` : '' }}</span>
          <Select
            :model-value="projMap[p.name] || NONE"
            :label="p.name"
            :options="projectOptions"
            @update:model-value="(x) => (projMap[p.name] = !x || x === NONE ? '' : x)"
          />
        </div>
      </div>
      <div v-if="filePeople.length" class="flex flex-col gap-1">
        <h2 class="font-medium">{{ tr('people') }}</h2>
        <p v-if="isAdmin" class="text-xs text-fg-muted">{{ tr('createHint') }}</p>
        <div v-for="n in filePeople" :key="n" class="import-person flex items-center gap-2 text-sm">
          <span class="w-48">{{ n }}</span>
          <Select
            :model-value="people[n] || NONE"
            :label="n"
            :options="personOptions"
            @update:model-value="(x) => (people[n] = !x || x === NONE ? '' : x)"
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
        <Button variant="primary" class="import-start" :disabled="!canStart || busy" @click="run">
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
