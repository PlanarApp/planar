<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { AiApiError, call } from './api';
import { tr } from './data';
import { toBase64 } from './harnessUi';

// «Settings → AI → Packs» (project level): catalog, loaded packs, upload with conflict resolution, export
const props = defineProps<{ projectId: string }>();
type Pack = { packKey: string; title: string | null; active: boolean; rootPageId: string | null };
type Conflict = { key: string; pageId: string; title: string };
type Choice = 'reset' | 'keep' | 'merge';
const catalog = ref<{ key: string; title: string; actions: number }[]>([]);
const packs = ref<Pack[]>([]);
const warnings = ref<string[]>([]);
const err = ref('');
const busy = ref(false);
const zip = reactive({ packKey: '', title: '', data: '' });
// the upload being resolved: its source and the conflicting pages
const pending = ref<{
  packKey: string;
  zip?: string;
  title?: string;
  conflicts: Conflict[];
} | null>(null);
const choice = reactive<Record<string, Choice>>({});
const merged = reactive<Record<string, string>>({});

async function load() {
  const r = await call<{ catalog: typeof catalog.value; packs: Pack[]; warnings?: string[] }>(
    'GET',
    `packs?${new URLSearchParams({ projectId: props.projectId })}`,
  );
  catalog.value = r.catalog;
  packs.value = r.packs;
  warnings.value = r.warnings ?? [];
}
async function guard(fn: () => Promise<void>) {
  err.value = '';
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    err.value =
      e instanceof AiApiError && e.status === 403 ? tr('forbidden') : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
type Src = { packKey: string; zip?: string; title?: string };
async function upload(src: Src, resolve?: Record<string, unknown>) {
  await guard(async () => {
    const r = await call<{ status: 'ok' | 'conflict'; conflicts?: Conflict[] }>(
      'POST',
      'packs/upload',
      {
        projectId: props.projectId,
        ...src,
        resolve,
      },
    );
    if (r.status === 'conflict') {
      pending.value = { ...src, conflicts: r.conflicts ?? [] };
      for (const c of r.conflicts ?? []) choice[c.key] ??= 'keep';
    } else pending.value = null;
    await load();
  });
}
const fromCatalog = (key: string) => upload({ packKey: key });
async function pickZip(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  zip.data = f ? toBase64(await f.arrayBuffer()) : '';
}
const fromZip = () =>
  upload({ packKey: zip.packKey.trim(), zip: zip.data, title: zip.title.trim() || undefined });
const activate = (packKey: string) =>
  guard(async () => {
    await call('POST', 'packs/activate', { projectId: props.projectId, packKey });
    await load();
  });
const merge = (c: Conflict) =>
  guard(async () => {
    const p = pending.value!;
    const r = await call<{ merged: string }>('POST', 'packs/merge', {
      projectId: props.projectId,
      packKey: p.packKey,
      zip: p.zip,
      title: p.title,
      key: c.key,
    });
    merged[c.key] = r.merged;
    choice[c.key] = 'merge';
  });
const resolveAll = () => {
  const p = pending.value!;
  const resolve = Object.fromEntries(
    p.conflicts.map((c) => [
      c.key,
      choice[c.key] === 'merge' ? { merged: merged[c.key] } : choice[c.key],
    ]),
  );
  return upload(p, resolve);
};
const canResolve = () =>
  pending.value?.conflicts.every((c) => choice[c.key] !== 'merge' || merged[c.key]);
const exportUrl = (k: string) =>
  `/api/ai/packs/export?${new URLSearchParams({ projectId: props.projectId, packKey: k })}`;
onMounted(() => load().catch((e) => (err.value = (e as Error).message)));
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="ai-packs">
    <h3 class="font-medium">{{ tr('packs') }}</h3>
    <p v-if="err" role="alert" class="text-sm text-danger" data-testid="packs-error">{{ err }}</p>
    <p v-for="w in warnings" :key="w" class="text-sm text-fg-muted">{{ w }}</p>
    <ul class="flex flex-col gap-1 text-sm" data-testid="packs-list">
      <li v-for="p in packs" :key="p.packKey" class="flex flex-wrap items-center gap-3">
        <span class="font-medium">{{ p.title ?? p.packKey }}</span>
        <span v-if="p.active" class="rounded bg-bg-muted px-1.5 text-xs">{{ tr('active') }}</span>
        <button
          v-else
          type="button"
          class="underline"
          :disabled="busy"
          @click="activate(p.packKey)"
        >
          {{ tr('activate') }}
        </button>
        <a v-if="p.rootPageId" :href="`/m/docs/${p.rootPageId}`" class="underline">{{
          tr('openDoc')
        }}</a>
        <a :href="exportUrl(p.packKey)" class="underline">{{ tr('export') }}</a>
      </li>
    </ul>
    <p v-if="!packs.length" class="text-sm text-fg-muted">{{ tr('none') }}</p>

    <h4 class="text-sm font-medium">{{ tr('fromCatalog') }}</h4>
    <ul class="flex flex-col gap-1 text-sm">
      <li v-for="c in catalog" :key="c.key" class="flex items-center gap-3">
        {{ c.title }}
        <button
          type="button"
          class="underline"
          :disabled="busy"
          data-testid="packs-upload"
          @click="fromCatalog(c.key)"
        >
          {{ packs.some((p) => p.packKey === c.key) ? tr('reload') : tr('upload') }}
        </button>
      </li>
    </ul>

    <h4 class="text-sm font-medium">{{ tr('fromZip') }}</h4>
    <form class="flex flex-wrap items-end gap-2 text-sm" @submit.prevent="fromZip">
      <label class="flex flex-col gap-1"
        >{{ tr('packKey') }}
        <input
          v-model="zip.packKey"
          required
          pattern="[a-z][a-z0-9_\-]{0,49}"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <label class="flex flex-col gap-1"
        >{{ tr('packTitle') }}
        <input
          v-model="zip.title"
          maxlength="200"
          class="rounded-md border border-border bg-bg px-2 py-1"
        />
      </label>
      <input
        type="file"
        accept=".zip,application/zip"
        required
        data-testid="packs-zip"
        @change="pickZip"
      />
      <button
        type="submit"
        :disabled="busy || !zip.data"
        class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
      >
        {{ tr('upload') }}
      </button>
    </form>

    <div
      v-if="pending"
      class="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="packs-conflicts"
    >
      <p class="text-sm">{{ tr('conflicts') }}</p>
      <div v-for="c in pending.conflicts" :key="c.key" class="flex flex-col gap-1 text-sm">
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-medium">{{ c.title }}</span>
          <label
            v-for="o in ['reset', 'keep', 'merge'] as const"
            :key="o"
            class="flex items-center gap-1"
          >
            <input v-model="choice[c.key]" type="radio" :name="`c-${c.key}`" :value="o" />{{
              tr(o)
            }}
          </label>
          <button
            v-if="choice[c.key] === 'merge'"
            type="button"
            class="underline"
            :disabled="busy"
            @click="merge(c)"
          >
            {{ tr('mergeRun') }}
          </button>
        </div>
        <textarea
          v-if="choice[c.key] === 'merge' && merged[c.key] !== undefined"
          v-model="merged[c.key]"
          rows="8"
          class="rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs"
        />
      </div>
      <div class="flex gap-3">
        <button
          type="button"
          :disabled="busy || !canResolve()"
          data-testid="packs-resolve"
          class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
          @click="resolveAll"
        >
          {{ tr('resolve') }}
        </button>
        <button type="button" class="underline" @click="pending = null">{{ tr('cancel') }}</button>
      </div>
    </div>
  </section>
</template>
