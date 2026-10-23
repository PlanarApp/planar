<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';

interface Sub {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
}
interface Del {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
}

const EVENTS = ['task.created', 'task.updated', 'task.deleted', 'comment.created'];
const ru = !/^en/i.test(document.documentElement.lang || navigator.language || 'ru');
const L = ru
  ? {
      url: 'URL получателя',
      create: 'Создать',
      secret: 'Секрет (показывается один раз)',
      ping: 'Проверить',
      redeliver: 'Повторить',
      log: 'Журнал',
      del: 'Удалить',
      off: 'Выключить',
      on: 'Включить',
      empty: 'Нет доставок',
      title: 'Вебхуки',
    }
  : {
      url: 'Receiver URL',
      create: 'Create',
      secret: 'Secret (shown once)',
      ping: 'Ping',
      redeliver: 'Redeliver',
      log: 'Log',
      del: 'Delete',
      off: 'Disable',
      on: 'Enable',
      empty: 'No deliveries',
      title: 'Webhooks',
    };

const subs = ref<Sub[]>([]);
const logs = reactive<Record<string, Del[]>>({});
const secret = ref('');
const err = ref('');
const f = reactive({ url: '', events: [...EVENTS] });

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  err.value = '';
  const res = await fetch(`/api/webhooks/${path}`, {
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
  call<{ data: Sub[] }>('GET', 'subscriptions').then((r) => void (subs.value = r.data));
const loadLog = (id: string) =>
  call<{ data: Del[] }>('GET', `subscriptions/${id}/deliveries`).then(
    (r) => void (logs[id] = r.data),
  );

async function create() {
  const r = await call<{ secret: string }>('POST', 'subscriptions', {
    url: f.url.trim(),
    events: f.events,
  });
  secret.value = r.secret;
  f.url = '';
  await load();
}
const run = (p: Promise<unknown>, id?: string) =>
  p.then(() => (id ? loadLog(id) : load())).catch(() => {});

onMounted(() => void load().catch(() => {}));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="webhooks-settings">
    <h2 class="text-lg font-semibold">{{ L.title }}</h2>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>

    <form class="flex flex-col gap-2" @submit.prevent="create().catch(() => {})">
      <input
        v-model="f.url"
        type="url"
        required
        maxlength="2000"
        :placeholder="L.url"
        data-testid="wh-url"
        class="rounded-md border border-border bg-bg px-2 py-1"
      />
      <div class="flex flex-wrap gap-3 text-sm">
        <label v-for="e in EVENTS" :key="e" class="flex items-center gap-1">
          <input v-model="f.events" type="checkbox" :value="e" />{{ e }}
        </label>
      </div>
      <button
        type="submit"
        :disabled="!f.events.length"
        data-testid="wh-create"
        class="self-start rounded-md border border-border px-3 py-1"
      >
        {{ L.create }}
      </button>
    </form>

    <div v-if="secret" class="rounded-md border border-border p-2 text-sm" data-testid="wh-secret">
      {{ L.secret }}: <code>{{ secret }}</code>
      <button class="ml-2 underline" @click="secret = ''">×</button>
    </div>

    <ul class="flex flex-col gap-3">
      <li
        v-for="s in subs"
        :key="s.id"
        class="rounded-md border border-border p-2"
        data-testid="wh-sub"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="break-all font-medium">{{ s.url }}</span>
          <span class="text-xs text-fg-muted">{{ s.events.join(', ') }}</span>
          <span class="text-xs">{{ s.active ? 'active' : 'off' }}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-2 text-sm">
          <button
            data-testid="wh-ping"
            @click="run(call('POST', `subscriptions/${s.id}/ping`), s.id)"
          >
            {{ L.ping }}
          </button>
          <button data-testid="wh-log" @click="loadLog(s.id).catch(() => {})">{{ L.log }}</button>
          <button @click="run(call('PATCH', `subscriptions/${s.id}`, { active: !s.active }))">
            {{ s.active ? L.off : L.on }}
          </button>
          <button @click="run(call('DELETE', `subscriptions/${s.id}`))">{{ L.del }}</button>
        </div>
        <table v-if="logs[s.id]" class="mt-2 w-full text-xs">
          <tr v-if="!logs[s.id]!.length">
            <td>{{ L.empty }}</td>
          </tr>
          <tr v-for="d in logs[s.id]" :key="d.id" data-testid="wh-delivery">
            <td>{{ d.event }}</td>
            <td>{{ d.status }}</td>
            <td>{{ d.attempts }}</td>
            <td>{{ d.lastStatus ?? d.lastError ?? '' }}</td>
            <td>
              <button
                data-testid="wh-redeliver"
                @click="run(call('POST', `deliveries/${d.id}/redeliver`), s.id)"
              >
                {{ L.redeliver }}
              </button>
            </td>
          </tr>
        </table>
      </li>
    </ul>
  </section>
</template>
