<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { editorExtensions } from '@planar/editor';
import type { Row } from '@planar/shared';
import { api, ApiError, Button, db, Dialog, useQuery } from '@planar/web/modules';
import { useTexts } from './text';

// PLNRAPP-185: page version history — list, read-only view, restore (DocsController)
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
  try {
    const { data } = await api<{ data: { body: object } }>('GET', `/api/docs/versions/${id}`);
    if (picked.value !== id) return;
    viewer.value?.destroy();
    viewer.value = new Editor({ editable: false, content: data.body, extensions: editorExtensions({ image: true }) });
  } catch {
    error.value = tx('versionsFailed');
  }
}

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
      <div class="doc-editor min-w-0 flex-1 overflow-auto rounded-md border border-border p-3 md:max-h-[60vh]">
        <EditorContent :editor="viewer ?? undefined" />
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
