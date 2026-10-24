<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { Badge, Button, EmptyState, IconButton, Input, Menu } from '@planar/web/modules';

// иконка «…» без lucide (у модуля нет этой зависимости)
const MoreHorizontal = () =>
  h(
    'svg',
    { viewBox: '0 0 24 24', fill: 'currentColor', width: 16, height: 16 },
    [5, 12, 19].map((cx) => h('circle', { cx, cy: 12, r: 1.5 })),
  );

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
      desc: 'Уведомления о событиях на внешний адрес',
      more: 'Действия',
      confirmDel: 'Удалить подписку?',
      emptyTitle: 'Нет подписок',
      emptyDesc: 'Добавьте адрес получателя, чтобы получать события',
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
      desc: 'Event notifications sent to an external URL',
      more: 'Actions',
      confirmDel: 'Delete subscription?',
      emptyTitle: 'No subscriptions',
      emptyDesc: 'Add a receiver URL to start receiving events',
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
  if (!f.url.trim()) return;
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
    <header class="flex flex-col gap-0.5">
      <h2 class="text-lg font-semibold">{{ L.title }}</h2>
      <p class="text-sm text-fg-muted">{{ L.desc }}</p>
    </header>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>

    <form class="flex flex-col gap-2" @submit.prevent="create().catch(() => {})">
      <div class="flex flex-wrap items-end gap-2">
        <Input
          v-model="f.url"
          type="url"
          :label="L.url"
          :placeholder="L.url"
          data-testid="wh-url"
          class="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          :disabled="!f.events.length"
          data-testid="wh-create"
        >
          {{ L.create }}
        </Button>
      </div>
      <div class="flex flex-wrap gap-3 text-sm">
        <label v-for="e in EVENTS" :key="e" class="flex items-center gap-1">
          <input v-model="f.events" type="checkbox" :value="e" />{{ e }}
        </label>
      </div>
    </form>

    <div
      v-if="secret"
      class="flex items-center gap-2 rounded-md border border-border p-2 text-sm"
      data-testid="wh-secret"
    >
      <span>
        {{ L.secret }}: <code class="font-mono">{{ secret }}</code>
      </span>
      <Button size="sm" variant="ghost" aria-label="×" class="ml-auto" @click="secret = ''"
        >×</Button
      >
    </div>

    <EmptyState v-if="!subs.length" :title="L.emptyTitle" :description="L.emptyDesc" />
    <ul v-else class="flex flex-col divide-y divide-border">
      <li v-for="s in subs" :key="s.id" class="group py-1" data-testid="wh-sub">
        <div class="flex min-h-8 flex-wrap items-center gap-2">
          <span class="min-w-0 break-all text-sm font-medium">{{ s.url }}</span>
          <span class="text-xs text-fg-muted">{{ s.events.join(', ') }}</span>
          <Badge v-if="!s.active">off</Badge>
          <span class="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              data-testid="wh-ping"
              @click="run(call('POST', `subscriptions/${s.id}/ping`), s.id)"
              >{{ L.ping }}</Button
            >
            <Button
              size="sm"
              variant="ghost"
              data-testid="wh-log"
              @click="loadLog(s.id).catch(() => {})"
              >{{ L.log }}</Button
            >
            <Menu
              align="end"
              :items="[
                {
                  id: 'toggle',
                  label: s.active ? L.off : L.on,
                  onSelect: () =>
                    run(call('PATCH', `subscriptions/${s.id}`, { active: !s.active })),
                },
                {
                  id: 'delete',
                  label: L.del,
                  danger: true,
                  confirm: { title: L.confirmDel, description: s.url, confirmLabel: L.del },
                  onSelect: () => run(call('DELETE', `subscriptions/${s.id}`)),
                },
              ]"
            >
              <template #trigger>
                <IconButton
                  :icon="MoreHorizontal"
                  :label="L.more"
                  size="sm"
                  data-testid="wh-menu"
                  class="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
                />
              </template>
            </Menu>
          </span>
        </div>
        <table v-if="logs[s.id]" class="mt-1 w-full text-xs">
          <tr v-if="!logs[s.id]!.length">
            <td>{{ L.empty }}</td>
          </tr>
          <tr v-for="d in logs[s.id]" :key="d.id" data-testid="wh-delivery">
            <td>{{ d.event }}</td>
            <td>{{ d.status }}</td>
            <td>{{ d.attempts }}</td>
            <td>{{ d.lastStatus ?? d.lastError ?? '' }}</td>
            <td>
              <Button
                size="sm"
                variant="ghost"
                data-testid="wh-redeliver"
                @click="run(call('POST', `deliveries/${d.id}/redeliver`), s.id)"
                >{{ L.redeliver }}</Button
              >
            </td>
          </tr>
        </table>
      </li>
    </ul>
  </section>
</template>
