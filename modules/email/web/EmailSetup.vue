<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { tr } from './data';

interface Cfg {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  hasPassword: boolean;
  from: string;
  configured: boolean;
}
const cfg = ref<Cfg | null>(null);
const err = ref('');
const info = ref('');
const f = reactive({
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  from: '',
  to: '',
});

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  err.value = '';
  info.value = '';
  const res = await fetch(`/api/email/setup/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.value = j.message || String(res.status);
    throw new Error(err.value);
  }
  return j as T;
}
const apply = (c: Cfg) => {
  cfg.value = c;
  Object.assign(f, {
    host: c.host,
    port: c.port,
    secure: c.secure,
    username: c.username ?? '',
    from: c.from,
    password: '',
  });
};
const save = (dropPassword = false) =>
  call<Cfg>('PUT', 'config', {
    host: f.host.trim(),
    port: Number(f.port),
    secure: f.secure,
    username: f.username.trim() || null,
    from: f.from.trim(),
    ...(dropPassword ? { password: null } : f.password ? { password: f.password } : {}),
  }).then(apply);
const test = () =>
  call('POST', 'test', { to: f.to.trim() }).then(() => void (info.value = tr('sent')));
const run = (p: Promise<unknown>) => p.catch(() => {});
onMounted(() => run(call<Cfg>('GET', 'config').then(apply)));
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="email-setup">
    <h2 class="text-lg font-semibold">{{ tr('title') }}</h2>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="email-error">{{ err }}</p>
    <p v-if="info" class="text-sm" data-testid="email-info">{{ info }}</p>
    <form class="flex flex-col gap-2" @submit.prevent="run(save())">
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('host') }}
        <input
          v-model="f.host"
          required
          maxlength="255"
          data-testid="email-host"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('port') }}
        <input
          v-model="f.port"
          type="number"
          min="1"
          max="65535"
          required
          data-testid="email-port"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="f.secure" type="checkbox" data-testid="email-secure" />{{ tr('secure') }}
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('username') }}
        <input
          v-model="f.username"
          maxlength="255"
          autocomplete="off"
          data-testid="email-user"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('password') }}
        <input
          v-model="f.password"
          type="password"
          maxlength="500"
          autocomplete="new-password"
          :placeholder="cfg?.hasPassword ? tr('passwordSet') : ''"
          data-testid="email-password"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm"
        >{{ tr('from') }}
        <input
          v-model="f.from"
          required
          maxlength="320"
          data-testid="email-from"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <div class="flex gap-2">
        <button
          type="submit"
          data-testid="email-save"
          class="rounded-md border border-border px-3 py-1"
        >
          {{ tr('save') }}
        </button>
        <button
          v-if="cfg?.hasPassword"
          type="button"
          data-testid="email-password-del"
          class="underline"
          @click="run(save(true))"
        >
          {{ tr('passwordDel') }}
        </button>
      </div>
    </form>
    <form class="flex gap-2" @submit.prevent="run(test())">
      <input
        v-model="f.to"
        type="email"
        required
        maxlength="320"
        :placeholder="tr('testTo')"
        data-testid="email-to"
        class="flex-1 rounded-md border border-border bg-bg px-2 py-1"
      />
      <button
        type="submit"
        data-testid="email-test"
        class="rounded-md border border-border px-3 py-1"
      >
        {{ tr('test') }}
      </button>
    </form>
  </section>
</template>
