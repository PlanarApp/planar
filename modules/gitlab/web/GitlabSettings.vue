<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { mutate, tr, useMergedStatuses, useProjects, useStatusList, type StatusLite } from './data';

interface Proj {
  id: string;
  gitlabProjectId: number;
  path: string;
  lastPolledAt: string | null;
  lastError: string | null;
}
interface Cfg {
  baseUrl: string;
  hasToken: boolean;
  intervalSec: number;
  lastError: string | null;
  lastErrorAt: string | null;
  projects: Proj[];
}

// projectId — настройки проекта-группы: только статус при слиянии MR этого проекта; подключение — в Воркспейсе
const props = defineProps<{ projectId?: string }>();
const cfg = ref<Cfg | null>(null);
const err = ref('');
const f = reactive({ baseUrl: '', token: '', intervalSec: 120, project: '' });
const projects = useProjects();
const statuses = useStatusList();
const merged = useMergedStatuses();

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  err.value = '';
  const res = await fetch(`/api/gitlab/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204 || res.status === 202) return undefined as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.value = j.message || String(res.status);
    throw new Error(err.value);
  }
  return j as T;
}
const apply = (c: Cfg) => {
  cfg.value = c;
  f.baseUrl = c.baseUrl;
  f.intervalSec = c.intervalSec;
  f.token = '';
};
const load = () => call<Cfg>('GET', 'config').then(apply);
const save = (token?: null) =>
  call<Cfg>('PUT', 'config', {
    baseUrl: f.baseUrl.trim(),
    intervalSec: Number(f.intervalSec),
    ...(token === null ? { token: null } : f.token ? { token: f.token } : {}),
  }).then(apply);
const addProject = () =>
  call('POST', 'projects', { project: f.project.trim() }).then(() => {
    f.project = '';
    return load();
  });
const run = (p: Promise<unknown>) => p.catch(() => {});

const statusesOf = (spaceId: string): StatusLite[] =>
  (statuses.value ?? []).filter((s) => s.spaceId === spaceId);
const setMerged = (projectId: string, v: string) =>
  mutate('gitlab.setMergedStatus', { projectId, statusId: v || null }).catch((e) => {
    err.value = String(e?.message ?? e);
  });

onMounted(() => !props.projectId && run(load()));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="gitlab-settings">
    <h2 class="text-lg font-semibold">{{ tr('title') }}</h2>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <p v-if="cfg?.lastError" class="text-sm text-danger" data-testid="gl-error">
      {{ tr('error') }}: {{ cfg.lastError }}
    </p>

    <template v-if="!props.projectId">
      <form class="flex flex-col gap-2" @submit.prevent="run(save())">
        <label class="flex flex-col gap-1 text-sm"
          >{{ tr('baseUrl') }}
          <input
            v-model="f.baseUrl"
            type="url"
            required
            maxlength="2000"
            data-testid="gl-url"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm"
          >{{ tr('token') }}
          <input
            v-model="f.token"
            type="password"
            autocomplete="off"
            maxlength="500"
            :placeholder="cfg?.hasToken ? tr('tokenSet') : ''"
            data-testid="gl-token"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm"
          >{{ tr('interval') }}
          <input
            v-model="f.intervalSec"
            type="number"
            min="60"
            max="3600"
            required
            data-testid="gl-interval"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
        <div class="flex gap-2">
          <button
            type="submit"
            data-testid="gl-save"
            class="rounded-md border border-border px-3 py-1"
          >
            {{ tr('save') }}
          </button>
          <button
            v-if="cfg?.hasToken"
            type="button"
            data-testid="gl-token-del"
            class="underline"
            @click="run(save(null))"
          >
            {{ tr('tokenDel') }}
          </button>
        </div>
      </form>

      <h3 class="font-medium">{{ tr('projects') }}</h3>
      <ul class="flex flex-col gap-2">
        <li
          v-for="p in cfg?.projects ?? []"
          :key="p.id"
          class="rounded-md border border-border p-2 text-sm"
          data-testid="gl-project"
        >
          <span class="font-medium">{{ p.path }}</span>
          <span v-if="p.lastPolledAt" class="ml-2 text-xs text-fg-muted"
            >{{ tr('polled') }} {{ p.lastPolledAt }}</span
          >
          <span
            v-if="p.lastError"
            class="ml-2 text-xs text-danger"
            data-testid="gl-project-error"
            >{{ p.lastError }}</span
          >
          <button
            class="ml-2 underline"
            data-testid="gl-remove"
            @click="run(call('DELETE', `projects/${p.id}`).then(load))"
          >
            {{ tr('remove') }}
          </button>
        </li>
      </ul>
      <form class="flex gap-2" @submit.prevent="run(addProject())">
        <input
          v-model="f.project"
          required
          maxlength="500"
          :placeholder="tr('addProject')"
          data-testid="gl-project-input"
          class="flex-1 rounded-md border border-border bg-bg px-2 py-1"
        />
        <button
          type="submit"
          data-testid="gl-add"
          class="rounded-md border border-border px-3 py-1"
        >
          {{ tr('add') }}
        </button>
      </form>
      <button class="self-start underline" data-testid="gl-poll" @click="run(call('POST', 'poll'))">
        {{ tr('poll') }}
      </button>
    </template>

    <h3 class="font-medium">{{ tr('merge') }}</h3>
    <ul class="flex flex-col gap-1">
      <li
        v-for="p in (projects ?? []).filter((x) => !props.projectId || x.id === props.projectId)"
        :key="p.id"
        class="flex items-center gap-2 text-sm"
        data-testid="gl-merge-row"
      >
        <span class="w-48 truncate">{{ p.name }}</span>
        <select
          :value="merged?.[p.id] ?? ''"
          data-testid="gl-merge-select"
          class="rounded-md border border-border bg-bg px-2 py-1"
          @change="setMerged(p.id, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ tr('off') }}</option>
          <option v-for="s in statusesOf(p.spaceId)" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </li>
    </ul>
  </section>
</template>
