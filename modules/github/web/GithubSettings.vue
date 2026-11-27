<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button, ConfirmDialog, Input } from '@planar/web/modules';
import {
  WORKSPACE_SCOPE_ID,
  type GithubConnectionView,
  type GithubLevelView,
  type GithubScope,
} from '../shared/index.js';

// PLNRAPP-890: github.com connections of a level (personal token), as the GitLab connections panel:
// the workspace manages its list; a space / project picks one of the parents' (or inherits) or adds its own
const props = defineProps<{ level: GithubScope; spaceId?: string; projectId?: string }>();
const scopeId = computed(() =>
  props.level === 'workspace'
    ? WORKSPACE_SCOPE_ID
    : ((props.level === 'space' ? props.spaceId : props.projectId) ?? ''),
);

const ru = !/^en/i.test(document.documentElement.lang || navigator.language || 'ru');
const L = ru
  ? {
      title: 'GitHub',
      desc: 'Подключения к github.com с персональным токеном',
      token: 'Персональный токен GitHub',
      connect: 'Подключить',
      connected: 'Подключено как',
      disconnect: 'Отключить',
      confirm: 'Отключить GitHub?',
      confirmDesc: 'Подключение и его токен будут удалены из Planar.',
      pick: 'Подключение',
      inherit: 'Наследовать',
      own: 'Своё подключение…',
      none: 'Подключение GitHub не настроено',
      level_workspace: 'воркспейс',
      level_space: 'пространство',
      level_project: 'проект',
    }
  : {
      title: 'GitHub',
      desc: 'Connections to github.com with a personal access token',
      token: 'GitHub personal access token',
      connect: 'Connect',
      connected: 'Connected as',
      disconnect: 'Disconnect',
      confirm: 'Disconnect GitHub?',
      confirmDesc: 'The connection and its token will be removed from Planar.',
      pick: 'Connection',
      inherit: 'Inherit',
      own: 'Own connection…',
      none: 'No GitHub connection is configured',
      level_workspace: 'workspace',
      level_space: 'space',
      level_project: 'project',
    };

const view = ref<GithubLevelView>({ connections: [], choice: null, effective: null });
const loaded = ref(false);
const adding = ref(false);
const token = ref('');
// the error of the last request: under the token field when connecting, above the list otherwise
const err = ref('');
const connectErr = ref('');
const busy = ref(false);
const removing = ref<GithubConnectionView | null>(null);
const confirmOpen = computed({
  get: () => !!removing.value,
  set: (v) => {
    if (!v) removing.value = null;
  },
});

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/github/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || String(res.status));
  return j as T;
}
const run = async (f: () => Promise<unknown>, target = err) => {
  busy.value = true;
  err.value = '';
  connectErr.value = '';
  try {
    await f();
  } catch (e) {
    target.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};

const base = () => `levels/${props.level}/${scopeId.value}`;
const load = () =>
  call<GithubLevelView>('GET', base()).then((v) => {
    view.value = v;
    loaded.value = true;
  });

const own = computed(() => view.value.connections.filter((c) => c.scope === props.level));
const effective = computed(() => view.value.connections.find((c) => c.id === view.value.effective));
const showForm = computed(() => props.level === 'workspace' || adding.value);

const choose = (v: string) => {
  if (v === '__new') {
    adding.value = true;
    return;
  }
  adding.value = false;
  return run(() => call('PUT', `${base()}/choice`, { connectionId: v || null }).then(load));
};
const connect = () =>
  run(async () => {
    if (!token.value.trim()) return;
    await call('POST', 'connections', {
      scope: props.level,
      scopeId: scopeId.value,
      token: token.value.trim(),
    });
    token.value = '';
    adding.value = false;
    await load();
  }, connectErr);
const disconnect = () => {
  const c = removing.value;
  if (!c) return;
  removing.value = null;
  return run(() => call('DELETE', `connections/${c.id}`).then(load));
};

onMounted(() => void run(load));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="github-settings">
    <header class="flex flex-col gap-0.5">
      <h2 class="text-lg font-semibold">{{ L.title }}</h2>
      <p class="text-sm text-fg-muted">{{ L.desc }}</p>
    </header>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>

    <template v-if="loaded">
      <label v-if="level !== 'workspace'" class="flex flex-wrap items-center gap-2 text-sm"
        >{{ L.pick }}
        <select
          :value="adding ? '__new' : (view.choice ?? '')"
          data-testid="gh-choice"
          class="rounded-md border border-border bg-bg px-2 py-1"
          @change="choose(($event.target as HTMLSelectElement).value)"
        >
          <option value="">
            {{ L.inherit }}{{ view.choice === null && effective ? ` (${effective.login})` : '' }}
          </option>
          <option v-for="c in view.connections" :key="c.id" :value="c.id">
            {{ c.login }} · {{ L[`level_${c.scope}`] }}
          </option>
          <option value="__new">{{ L.own }}</option>
        </select>
      </label>
      <p v-if="!effective" class="text-sm text-fg-muted" data-testid="gh-none">{{ L.none }}</p>

      <ul v-if="own.length" class="flex flex-col gap-2">
        <li
          v-for="c in own"
          :key="c.id"
          class="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
          data-testid="gh-connected"
        >
          <span
            >{{ L.connected }} <b data-testid="gh-login">{{ c.login }}</b></span
          >
          <Button
            size="sm"
            variant="danger"
            :disabled="busy"
            data-testid="gh-disconnect"
            @click="removing = c"
            >{{ L.disconnect }}</Button
          >
        </li>
      </ul>
      <ConfirmDialog
        v-model:open="confirmOpen"
        :title="L.confirm"
        :description="L.confirmDesc"
        :confirm-label="L.disconnect"
        @confirm="disconnect"
      />

      <form
        v-if="showForm"
        class="flex flex-wrap items-start gap-2"
        data-testid="gh-form"
        @submit.prevent="connect"
      >
        <Input
          v-model="token"
          type="password"
          autocomplete="off"
          :label="L.token"
          :error="connectErr || undefined"
          required
          maxlength="500"
          data-testid="gh-token"
          class="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          class="mt-5"
          :disabled="busy || !token.trim()"
          data-testid="gh-connect"
          >{{ L.connect }}</Button
        >
      </form>
    </template>
  </section>
</template>
