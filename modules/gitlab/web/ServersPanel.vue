<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { WORKSPACE_SCOPE_ID, type GitlabScope, type GitlabServerView } from '../shared/index.js';
import { tr } from './data';

// GitLab connections of a level: the workspace manages the list; a space / project picks one
// of the parents' (or inherits) or adds its own
const props = defineProps<{ level: GitlabScope; spaceId?: string; projectId?: string }>();
const scopeId = computed(() =>
  props.level === 'workspace'
    ? WORKSPACE_SCOPE_ID
    : ((props.level === 'space' ? props.spaceId : props.projectId) ?? ''),
);
interface View {
  servers: GitlabServerView[];
  choice: string | null;
  effective: string | null;
}
const view = ref<View>({ servers: [], choice: null, effective: null });
const err = ref('');
const adding = ref(false);
const f = reactive({ name: '', baseUrl: 'https://gitlab.com', token: '' });
const edit = reactive<Record<string, { name: string; token: string }>>({});

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  err.value = '';
  const res = await fetch(`/api/gitlab/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.value = j.message || String(res.status);
    throw new Error(err.value);
  }
  return j as T;
}
const load = () =>
  call<View>('GET', `levels/${props.level}/${scopeId.value}`).then((v) => {
    view.value = v;
    for (const s of v.servers) edit[s.id] ??= { name: s.name, token: '' };
  });
const run = (p: Promise<unknown>) => p.catch(() => {});

const own = computed(() => view.value.servers.filter((s) => s.scope === props.level));
const effective = computed(() => view.value.servers.find((s) => s.id === view.value.effective));
const levelName = (s: GitlabServerView) => tr(`level_${s.scope}`);
const choose = (v: string) => {
  if (v === '__new') {
    adding.value = true;
    return;
  }
  adding.value = false;
  return run(
    call('PUT', `levels/${props.level}/${scopeId.value}/choice`, { serverId: v || null }).then(
      load,
    ),
  );
};
const add = () =>
  call('POST', 'servers', {
    scope: props.level,
    scopeId: scopeId.value,
    name: f.name.trim(),
    baseUrl: f.baseUrl.trim(),
    token: f.token,
  }).then(() => {
    f.name = '';
    f.token = '';
    adding.value = false;
    return load();
  });
const save = (s: GitlabServerView) =>
  call('PATCH', `servers/${s.id}`, {
    name: edit[s.id]!.name.trim() || s.name,
    ...(edit[s.id]!.token && { token: edit[s.id]!.token }),
  }).then(() => {
    edit[s.id]!.token = '';
    return load();
  });

onMounted(() => run(load()));
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="gl-servers">
    <h3 class="font-medium">{{ tr('servers') }}</h3>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>

    <label v-if="level !== 'workspace'" class="flex flex-wrap items-center gap-2 text-sm"
      >{{ tr('serverPick') }}
      <select
        :value="adding ? '__new' : (view.choice ?? '')"
        data-testid="gl-choice"
        class="rounded-md border border-border bg-bg px-2 py-1"
        @change="choose(($event.target as HTMLSelectElement).value)"
      >
        <option value="">
          {{ tr('inherit') }}{{ view.choice === null && effective ? ` (${effective.name})` : '' }}
        </option>
        <option v-for="s in view.servers" :key="s.id" :value="s.id">
          {{ s.name }} · {{ levelName(s) }}
        </option>
        <option value="__new">{{ tr('own') }}</option>
      </select>
    </label>
    <p v-if="level !== 'workspace' && !effective" class="text-sm text-fg-muted">
      {{ tr('noServer') }}
    </p>

    <ul class="flex flex-col gap-2">
      <li
        v-for="s in own"
        :key="s.id"
        class="flex flex-col gap-2 rounded-md border border-border p-2 text-sm"
        data-testid="gl-server"
      >
        <div>
          <span class="font-medium">{{ s.name }}</span>
          <span class="ml-2 text-xs text-fg-muted">{{ s.baseUrl }}</span>
        </div>
        <form class="flex flex-wrap gap-2" @submit.prevent="run(save(s))">
          <input
            v-model="edit[s.id]!.name"
            required
            maxlength="100"
            :aria-label="tr('name')"
            data-testid="gl-server-name"
            class="rounded-md border border-border bg-bg px-2 py-1"
          />
          <input
            v-model="edit[s.id]!.token"
            type="password"
            autocomplete="off"
            maxlength="500"
            :placeholder="tr('newToken')"
            :aria-label="tr('newToken')"
            data-testid="gl-server-token"
            class="flex-1 rounded-md border border-border bg-bg px-2 py-1"
          />
          <button type="submit" class="rounded-md border border-border px-3 py-1">
            {{ tr('save') }}
          </button>
          <button
            type="button"
            class="underline"
            data-testid="gl-server-remove"
            @click="run(call('DELETE', `servers/${s.id}`).then(load))"
          >
            {{ tr('remove') }}
          </button>
        </form>
      </li>
    </ul>

    <form
      v-if="level === 'workspace' || adding"
      class="flex flex-col gap-2"
      data-testid="gl-server-form"
      @submit.prevent="run(add())"
    >
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('name') }}
        <input
          v-model="f.name"
          required
          maxlength="100"
          data-testid="gl-name"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
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
      <button
        type="submit"
        data-testid="gl-server-add"
        class="self-start rounded-md border border-border px-3 py-1"
      >
        {{ tr('addServer') }}
      </button>
    </form>
  </section>
</template>
