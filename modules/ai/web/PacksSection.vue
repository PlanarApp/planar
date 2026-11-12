<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { AiApiError, call } from './api';
import { tr } from './data';
import { toBase64 } from './harnessUi';
import PackConflicts from './PackConflicts.vue';
import { usePackUpload } from './usePackUpload';

// «Settings → AI → Packs» (project level): catalog, loaded packs, upload with conflict resolution, export
const props = defineProps<{ projectId: string }>();
type Pack = { packKey: string; title: string | null; active: boolean; rootPageId: string | null };
const catalog = ref<{ key: string; title: string; actions: number }[]>([]);
const packs = ref<Pack[]>([]);
const warnings = ref<string[]>([]);
const err = ref('');
const busy = ref(false);
const zip = reactive({ packKey: '', title: '', data: '' });

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
const u = usePackUpload(props.projectId, guard, load);
const fromCatalog = (key: string) => u.upload({ packKey: key });
async function pickZip(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  zip.data = f ? toBase64(await f.arrayBuffer()) : '';
}
const fromZip = () =>
  u.upload({ packKey: zip.packKey.trim(), zip: zip.data, title: zip.title.trim() || undefined });
const activate = (packKey: string) =>
  guard(async () => {
    await call('POST', 'packs/activate', { projectId: props.projectId, packKey });
    await load();
  });
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

    <PackConflicts :u="u" :busy="busy" />
  </section>
</template>
