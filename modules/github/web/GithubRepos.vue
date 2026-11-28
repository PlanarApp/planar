<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Button, Input } from '@planar/web/modules';
import type { GithubAvailableView, GithubRepoOption, GithubRepoView } from '../shared/index.js';

// PLNRAPP-891: the project's github.com repositories, as the GitLab bindings: the bound ones with «Отвязать»,
// the choice from the repositories of the project's connection (with a search) and «Привязать»
const props = defineProps<{ projectId: string; reload?: number }>();

const ru = !/^en/i.test(document.documentElement.lang || navigator.language || 'ru');
const L = ru
  ? {
      title: 'Репозитории',
      bound: 'Привязанные репозитории',
      noBound: 'Репозитории не привязаны',
      unbind: 'Отвязать',
      bind: 'Привязать',
      search: 'Поиск репозитория',
      pick: 'Репозиторий',
      already: 'привязан',
      empty: 'Нет репозиториев',
      loading: 'Загрузка репозиториев…',
      hint: 'Подключите GitHub, чтобы привязать репозиторий к проекту',
      branch: 'ветка',
      sync: 'Синхронизировать PR и коммиты',
      synced: (p: number, c: number) => `Связано с задачами: PR — ${p}, коммитов — ${c}`,
      noHook: 'Вебхук не создан — PR и коммиты обновляет опрос',
    }
  : {
      title: 'Repositories',
      bound: 'Bound repositories',
      noBound: 'No repositories are bound',
      unbind: 'Unbind',
      bind: 'Bind',
      search: 'Search repositories',
      pick: 'Repository',
      already: 'bound',
      empty: 'No repositories',
      loading: 'Loading repositories…',
      hint: 'Connect GitHub to bind a repository to the project',
      branch: 'branch',
      sync: 'Sync PRs and commits',
      synced: (p: number, c: number) => `Linked to tasks: ${p} PRs, ${c} commits`,
      noHook: 'No webhook — PRs and commits are refreshed by polling',
    };

const repos = ref<GithubRepoView[]>([]);
const options = ref<GithubRepoOption[]>([]);
const connected = ref<boolean | null>(null);
const listErr = ref('');
const err = ref('');
const busy = ref(false);
const loadingList = ref(false);
const q = ref('');
// PLNRAPP-892: a one-off sync of the bound repositories' PRs and commits to the tasks
const syncMsg = ref('');
async function sync() {
  busy.value = true;
  err.value = '';
  syncMsg.value = '';
  try {
    const r = await call<{ prs: number; commits: number }>('POST', `${base()}/sync`);
    syncMsg.value = L.synced(r.prs, r.commits);
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const picked = ref('');

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

const base = () => `projects/${props.projectId}`;
const loadBound = () =>
  call<{ repos: GithubRepoView[] }>('GET', `${base()}/repos`).then((r) => (repos.value = r.repos));
async function loadAvailable() {
  loadingList.value = true;
  listErr.value = '';
  try {
    const r = await call<GithubAvailableView>('GET', `${base()}/available`);
    connected.value = r.connected;
    options.value = r.repos;
  } catch (e) {
    // an invalid / revoked token: the list is not shown, the connection error is
    connected.value = true;
    options.value = [];
    listErr.value = (e as Error).message;
  } finally {
    loadingList.value = false;
  }
}

const boundIds = computed(() => new Set(repos.value.map((r) => r.repoId)));
const shown = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return needle
    ? options.value.filter((r) => r.fullName.toLowerCase().includes(needle))
    : options.value;
});

const run = async (f: () => Promise<unknown>) => {
  busy.value = true;
  err.value = '';
  try {
    await f();
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
};
const bind = () =>
  run(async () => {
    if (!picked.value) return;
    await call('POST', `${base()}/repos`, { fullName: picked.value });
    picked.value = '';
    await loadBound();
  });
const unbind = (r: GithubRepoView) => run(() => call('DELETE', `repos/${r.id}`).then(loadBound));

const loadAll = () => run(() => Promise.all([loadBound(), loadAvailable()]));
onMounted(loadAll);
// the connection of the project changed in the panel above — the available list is another one
// (its first load, 0 → 1, is the mount: this panel loads itself)
watch(
  () => props.reload ?? 0,
  (v, old) => {
    if (old > 0 && v !== old) void loadAll();
  },
);
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="github-repos">
    <h3 class="font-medium">{{ L.title }}</h3>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="gh-repos-error">
      {{ err }}
    </p>

    <ul v-if="repos.length" class="flex flex-col gap-2">
      <li
        v-for="r in repos"
        :key="r.id"
        class="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
        data-testid="gh-repo"
      >
        <span class="font-medium" data-testid="gh-repo-name">{{ r.fullName }}</span>
        <span class="text-xs text-fg-muted">{{ L.branch }} {{ r.defaultBranch }}</span>
        <!-- PLNRAPP-894: the webhook was not registered (no rights, unreachable URL) — the poller syncs -->
        <span v-if="!r.hook" class="text-xs text-warning" data-testid="gh-repo-no-hook">{{
          ru ? (r.hookError ?? L.noHook) : L.noHook
        }}</span>
        <Button
          size="sm"
          variant="danger"
          :disabled="busy"
          data-testid="gh-unbind"
          @click="unbind(r)"
          >{{ L.unbind }}</Button
        >
      </li>
    </ul>
    <p v-else class="text-sm text-fg-muted" data-testid="gh-no-repos">{{ L.noBound }}</p>
    <div v-if="repos.length" class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" :disabled="busy" data-testid="gh-sync" @click="sync">{{
        L.sync
      }}</Button>
      <span v-if="syncMsg" class="text-sm text-fg-muted" data-testid="gh-sync-result">{{
        syncMsg
      }}</span>
    </div>

    <p v-if="connected === false" class="text-sm text-fg-muted" data-testid="gh-repos-hint">
      {{ L.hint }}
    </p>
    <p v-else-if="listErr" role="alert" class="text-sm text-danger" data-testid="gh-list-error">
      {{ listErr }}
    </p>
    <p v-else-if="loadingList" class="text-sm text-fg-muted">{{ L.loading }}</p>
    <form
      v-else-if="connected"
      class="flex flex-col gap-2"
      data-testid="gh-bind-form"
      @submit.prevent="bind"
    >
      <Input v-model="q" :label="L.search" maxlength="200" data-testid="gh-repo-search" />
      <label class="flex flex-col gap-1 text-sm"
        >{{ L.pick }}
        <select
          v-model="picked"
          size="8"
          data-testid="gh-repo-options"
          class="rounded-md border border-border bg-bg px-2 py-1"
        >
          <option
            v-for="o in shown"
            :key="o.repoId"
            :value="o.fullName"
            :disabled="boundIds.has(o.repoId)"
          >
            {{ o.fullName }}{{ boundIds.has(o.repoId) ? ` (${L.already})` : '' }}
          </option>
        </select>
      </label>
      <p v-if="!shown.length" class="text-sm text-fg-muted" data-testid="gh-repo-empty">
        {{ L.empty }}
      </p>
      <Button
        type="submit"
        variant="primary"
        class="self-start"
        :disabled="busy || !picked"
        data-testid="gh-bind"
        >{{ L.bind }}</Button
      >
    </form>
  </section>
</template>
