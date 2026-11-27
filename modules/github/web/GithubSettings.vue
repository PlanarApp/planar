<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button, ConfirmDialog, Input } from '@planar/web/modules';
import type { GithubConnectionView } from '../shared/index.js';

// PLNRAPP-890: the workspace connection to github.com with a personal token
const ru = !/^en/i.test(document.documentElement.lang || navigator.language || 'ru');
const L = ru
  ? {
      title: 'GitHub',
      desc: 'Подключение к github.com с персональным токеном',
      token: 'Персональный токен GitHub',
      connect: 'Подключить',
      connected: 'Подключено как',
      disconnect: 'Отключить',
      confirm: 'Отключить GitHub?',
      confirmDesc: 'Токен будет удалён из Planar.',
    }
  : {
      title: 'GitHub',
      desc: 'Connection to github.com with a personal access token',
      token: 'GitHub personal access token',
      connect: 'Connect',
      connected: 'Connected as',
      disconnect: 'Disconnect',
      confirm: 'Disconnect GitHub?',
      confirmDesc: 'The token will be removed from Planar.',
    };

const conn = ref<GithubConnectionView | null>(null);
const loaded = ref(false);
const token = ref('');
const err = ref('');
const busy = ref(false);
const confirmOpen = ref(false);

async function call<T>(method: string, body?: unknown): Promise<T> {
  err.value = '';
  const res = await fetch('/api/github/connection', {
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
const run = async (f: () => Promise<unknown>) => {
  busy.value = true;
  try {
    await f();
  } catch {
    // the text is in err
  } finally {
    busy.value = false;
  }
};

const load = () =>
  call<{ connection: GithubConnectionView | null }>('GET').then((r) => {
    conn.value = r.connection;
    loaded.value = true;
  });
const connect = () =>
  run(async () => {
    if (!token.value.trim()) return;
    conn.value = (
      await call<{ connection: GithubConnectionView }>('PUT', { token: token.value.trim() })
    ).connection;
    token.value = '';
  });
const disconnect = () =>
  run(async () => {
    await call('DELETE');
    conn.value = null;
  });

onMounted(() => void run(load));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="github-settings">
    <header class="flex flex-col gap-0.5">
      <h2 class="text-lg font-semibold">{{ L.title }}</h2>
      <p class="text-sm text-fg-muted">{{ L.desc }}</p>
    </header>

    <template v-if="conn">
      <div class="flex flex-wrap items-center gap-2 text-sm" data-testid="gh-connected">
        <span
          >{{ L.connected }} <b data-testid="gh-login">{{ conn.login }}</b></span
        >
        <Button
          size="sm"
          variant="danger"
          :disabled="busy"
          data-testid="gh-disconnect"
          @click="confirmOpen = true"
          >{{ L.disconnect }}</Button
        >
      </div>
      <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
      <ConfirmDialog
        v-model:open="confirmOpen"
        :title="L.confirm"
        :description="L.confirmDesc"
        :confirm-label="L.disconnect"
        @confirm="disconnect"
      />
    </template>

    <form
      v-else-if="loaded || err"
      class="flex flex-wrap items-start gap-2"
      data-testid="gh-form"
      @submit.prevent="connect"
    >
      <Input
        v-model="token"
        type="password"
        autocomplete="off"
        :label="L.token"
        :error="err || undefined"
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
  </section>
</template>
