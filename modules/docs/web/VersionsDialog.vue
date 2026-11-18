<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { editorExtensions } from '@planar/editor';
import type { Row } from '@planar/shared';
import { api, ApiError, Button, db, Dialog, useQuery } from '@planar/web/modules';
import { useTexts } from './text';
import { changes, diffDocs, type DiffBlock } from './diff';

// PLNRAPP-185: page version history — list, read-only view, restore (DocsController)
// PLNRAPP-282: «Изменения» — inline diff of the picked version against another one (the previous by default)
type Version = { id: string; source: 'editor' | 'api' | 'restore' | null; createdBy: string; createdAt: string };
const props = defineProps<{ pageId: string }>();
const open = defineModel<boolean>('open', { default: false });
const tx = useTexts();
const users = useQuery(() => db.table<Row<'users'>>('users').toArray());
const name = (id: string) => users.value?.find((u) => u.id === id)?.name ?? '';
const SOURCE = { editor: 'srcEditor', api: 'srcApi', restore: 'srcRestore' } as const;

const versions = ref<Version[] | null>(null);
const picked = ref<string | null>(null);
const error = ref('');
const busy = ref(false);
const viewer = shallowRef<Editor | null>(null);
const showDiff = ref(false);
/** the version the picked one is compared with; '' — an empty page (the picked one is the oldest) */
const base = ref('');
const diff = shallowRef<DiffBlock[] | null>(null);
const bodies = new Map<string, object>();

async function body(id: string) {
  if (!bodies.has(id))
    bodies.set(id, (await api<{ data: { body: object } }>('GET', `/api/docs/versions/${id}`)).data.body);
  return bodies.get(id)!;
}

watch(open, async (v) => {
  if (!v) return;
  versions.value = null;
  error.value = '';
  try {
    versions.value = (await api<{ data: Version[] }>('GET', `/api/docs/pages/${props.pageId}/versions`)).data;
    if (versions.value[0]) void pick(versions.value[0].id);
  } catch {
    error.value = tx('versionsFailed');
    versions.value = [];
  }
}, { immediate: true });

async function pick(id: string) {
  picked.value = id;
  const list = versions.value ?? [];
  base.value = list[list.findIndex((v) => v.id === id) + 1]?.id ?? '';
  try {
    const content = await body(id);
    if (picked.value !== id) return;
    viewer.value?.destroy();
    viewer.value = new Editor({ editable: false, content, extensions: editorExtensions({ image: true }) });
  } catch {
    error.value = tx('versionsFailed');
  }
}

// the older of the two versions is «before», the newer — «after» (the list is newest first)
watch([showDiff, picked, base], async () => {
  diff.value = null;
  const [id, other] = [picked.value, base.value];
  if (!showDiff.value || !id) return;
  try {
    const list = versions.value ?? [];
    const idx = (v: string) => (v ? list.findIndex((x) => x.id === v) : list.length);
    const [a, b] = await Promise.all([body(id), other ? body(other) : null]);
    if (picked.value !== id || base.value !== other || !showDiff.value) return;
    diff.value = idx(other) > idx(id) ? diffDocs(b, a) : diffDocs(a, b);
  } catch {
    error.value = tx('versionsFailed');
  }
});
const label = (v: Version) => `${new Date(v.createdAt).toLocaleString()} · ${name(v.createdBy)}`;
const PART = {
  eq: '',
  ins: 'rounded-sm bg-success/15 text-success',
  del: 'rounded-sm bg-danger/15 text-danger line-through',
} as const;
const BLOCK = { eq: 'border-transparent', mod: 'border-warning', ins: 'border-success', del: 'border-danger' } as const;

async function restore() {
  if (!picked.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api('POST', `/api/docs/versions/${picked.value}/restore`);
    open.value = false;
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 403 ? tx('restoreForbidden') : tx('restoreFailed');
  } finally {
    busy.value = false;
  }
}
const latest = computed(() => versions.value?.[0]?.id);
onBeforeUnmount(() => viewer.value?.destroy());
</script>

<template>
  <Dialog v-model:open="open" :title="tx('history')" size="lg">
    <p v-if="versions === null" class="text-fg-muted">…</p>
    <p v-else-if="!versions.length && !error" class="text-fg-muted">{{ tx('noVersions') }}</p>
    <div v-else class="flex min-h-0 flex-col gap-3 md:flex-row">
      <ul class="flex max-h-40 shrink-0 flex-col gap-1 overflow-auto md:max-h-[60vh] md:w-56" data-testid="doc-versions">
        <li v-for="v in versions" :key="v.id">
          <button
            type="button"
            :aria-pressed="picked === v.id"
            class="w-full rounded-md px-2 py-1.5 text-left hover:bg-bg-muted focus-visible:ring-2 ring-focus outline-none"
            :class="picked === v.id && 'bg-bg-muted'"
            @click="pick(v.id)"
          >
            <span class="block text-sm">{{ new Date(v.createdAt).toLocaleString() }}</span>
            <span class="block text-xs text-fg-muted">
              {{ name(v.createdBy) }}<template v-if="v.source"> · {{ tx(SOURCE[v.source]) }}</template>
            </span>
          </button>
        </li>
      </ul>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <label class="flex items-center gap-1.5">
            <input v-model="showDiff" type="checkbox" data-testid="doc-version-diff" />
            {{ tx('diff') }}
          </label>
          <template v-if="showDiff">
            <label class="flex items-center gap-1.5">
              {{ tx('diffWith') }}
              <select
                v-model="base"
                class="rounded-md border border-border bg-bg px-2 py-1"
                data-testid="doc-version-base"
              >
                <option v-for="v in (versions ?? []).filter((x) => x.id !== picked)" :key="v.id" :value="v.id">
                  {{ label(v) }}
                </option>
                <option value="">{{ tx('diffEmpty') }}</option>
              </select>
            </label>
            <span v-if="diff" class="text-fg-muted" data-testid="doc-version-changes">
              {{ tx('diffCount', { n: String(changes(diff)) }) }}
            </span>
          </template>
        </div>
        <div
          v-if="showDiff"
          class="min-w-0 flex-1 overflow-auto rounded-md border border-border p-3 md:max-h-[55vh]"
          data-testid="doc-version-diff-view"
        >
          <p v-if="diff === null" class="text-fg-muted">…</p>
          <p
            v-for="(b, k) in diff ?? []"
            :key="k"
            class="mb-1 whitespace-pre-wrap border-l-2 pl-2"
            :class="[BLOCK[b.op], b.kind === 'heading' && 'font-semibold', b.kind === 'codeBlock' && 'font-mono text-sm']"
            :data-op="b.op"
          >
            <template v-if="b.kind === 'image'">
              <span :class="PART[b.parts[0]!.op]">🖼 {{ tx('diffImage') }}</span>
            </template>
            <template v-else-if="b.kind === 'horizontalRule'">
              <span :class="PART[b.parts[0]!.op]">———</span>
            </template>
            <template v-else>
              <component
                :is="p.op === 'ins' ? 'ins' : p.op === 'del' ? 'del' : 'span'"
                v-for="(p, i) in b.parts"
                :key="i"
                :class="PART[p.op]"
              >{{ p.text }}</component>
            </template>
          </p>
        </div>
        <div v-else class="doc-editor min-w-0 flex-1 overflow-auto rounded-md border border-border p-3 md:max-h-[55vh]">
          <EditorContent :editor="viewer ?? undefined" />
        </div>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <div class="flex justify-end">
      <Button
        :disabled="!picked || picked === latest || busy"
        data-testid="doc-version-restore"
        @click="restore"
      >
        {{ tx('restore') }}
      </Button>
    </div>
  </Dialog>
</template>
