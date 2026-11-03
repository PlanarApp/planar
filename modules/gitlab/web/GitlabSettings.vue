<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { mutate, tr, useMergedStatuses, useProjects, useStatusList } from './data';

interface Conn {
  id: string;
  baseUrl: string;
  gitlabProjectId: number;
  path: string;
  lastPolledAt: string | null;
  lastError: string | null;
}

// project settings: its connections to GitLab repositories and the task status on MR merge
const props = defineProps<{ projectId: string }>();
const conns = ref<Conn[]>([]);
const err = ref('');
const f = reactive({ baseUrl: 'https://gitlab.com', token: '', project: '' });
const tokens = reactive<Record<string, string>>({});
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
const base = () => `projects/${props.projectId}/connections`;
const load = () =>
  call<{ connections: Conn[] }>('GET', base()).then((r) => (conns.value = r.connections));
const add = () =>
  call('POST', base(), {
    baseUrl: f.baseUrl.trim(),
    token: f.token,
    project: f.project.trim(),
  }).then(() => {
    f.token = '';
    f.project = '';
    return load();
  });
const setToken = (id: string) =>
  call('PATCH', `connections/${id}`, { token: tokens[id] }).then(() => {
    tokens[id] = '';
    return load();
  });
const run = (p: Promise<unknown>) => p.catch(() => {});

const project = computed(() => (projects.value ?? []).find((p) => p.id === props.projectId));
const spaceStatuses = computed(() =>
  (statuses.value ?? []).filter((s) => s.projectId === project.value?.id),
);
const setMerged = (v: string) =>
  mutate('gitlab.setMergedStatus', { projectId: props.projectId, statusId: v || null }).catch(
    (e) => {
      err.value = String(e?.message ?? e);
    },
  );

onMounted(() => run(load()));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="gitlab-settings">
    <h2 class="text-lg font-semibold">{{ tr('title') }}</h2>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>

    <h3 class="font-medium">{{ tr('connections') }}</h3>
    <ul class="flex flex-col gap-2">
      <li
        v-for="c in conns"
        :key="c.id"
        class="flex flex-col gap-2 rounded-md border border-border p-2 text-sm"
        data-testid="gl-conn"
      >
        <div>
          <span class="font-medium">{{ c.path }}</span>
          <span class="ml-2 text-xs text-fg-muted">{{ c.baseUrl }}</span>
          <span v-if="c.lastPolledAt" class="ml-2 text-xs text-fg-muted"
            >{{ tr('polled') }} {{ c.lastPolledAt }}</span
          >
          <span v-if="c.lastError" class="ml-2 text-xs text-danger" data-testid="gl-error"
            >{{ tr('error') }}: {{ c.lastError }}</span
          >
        </div>
        <form class="flex gap-2" @submit.prevent="run(setToken(c.id))">
          <input
            v-model="tokens[c.id]"
            type="password"
            autocomplete="off"
            required
            maxlength="500"
            :placeholder="tr('newToken')"
            :aria-label="tr('newToken')"
            data-testid="gl-conn-token"
            class="flex-1 rounded-md border border-border bg-bg px-2 py-1"
          />
          <button type="submit" class="rounded-md border border-border px-3 py-1">
            {{ tr('save') }}
          </button>
          <button
            type="button"
            class="underline"
            data-testid="gl-remove"
            @click="run(call('DELETE', `connections/${c.id}`).then(load))"
          >
            {{ tr('remove') }}
          </button>
        </form>
      </li>
    </ul>

    <form class="flex flex-col gap-2" data-testid="gl-add-form" @submit.prevent="run(add())">
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
          required
          maxlength="500"
          data-testid="gl-token"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('repo') }}
        <input
          v-model="f.project"
          required
          maxlength="500"
          data-testid="gl-project-input"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <button
        type="submit"
        data-testid="gl-add"
        class="self-start rounded-md border border-border px-3 py-1"
      >
        {{ tr('add') }}
      </button>
    </form>
    <button
      v-if="conns.length"
      class="self-start underline"
      data-testid="gl-poll"
      @click="run(call('POST', 'poll'))"
    >
      {{ tr('poll') }}
    </button>

    <label class="flex items-center gap-2 text-sm"
      >{{ tr('merge') }}
      <select
        :value="merged?.[props.projectId] ?? ''"
        data-testid="gl-merge-select"
        class="rounded-md border border-border bg-bg px-2 py-1"
        @change="setMerged(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ tr('off') }}</option>
        <option v-for="s in spaceStatuses" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </label>
  </section>
</template>
