<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Archive, Lock } from 'lucide-vue-next';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { db, mutate, useQuery, useSession, Menu, type MenuItem } from '@planar/web/modules';
import DocEditor from './DocEditor.vue';
import { useLock } from './lock';
import type { PageFull } from './model';
import { createSaver } from './save';
import { useTexts } from './text';

const props = defineProps<{ pageId: string }>();
const tx = useTexts();
const router = useRouter();
const user = useSession();
const page = useQuery(() => db.table<PageFull>('docsPages').get(props.pageId));
const users = useQuery(() => db.table<Row<'users'>>('users').toArray());
const members = computed(() => (users.value ?? []).map((u) => ({ id: u.id, name: u.name })));
const { other, editable } = useLock(
  () => props.pageId,
  () => user.value?.id,
);
const holder = computed(() => {
  if (other.value === null) return null;
  const u = users.value?.find((x) => x.id === other.value);
  return u ? tx('editing', { name: u.name }) : tx('editingOther');
});

const title = ref('');
// заголовок берём из реплики один раз; дальше его ведёт поле (свои правки или чужие в режиме чтения)
const seeded = ref(false);
watch(
  page,
  (p) => {
    if (p && (!seeded.value || !editable.value)) title.value = p.title;
    if (p) seeded.value = true;
  },
  { immediate: true },
);

const saver = createSaver<{ title?: string; body?: JSONContent }>((patch) =>
  mutate('docs.page.update', { id: props.pageId, ...patch }).catch(() => {}),
);
const onBody = (body: JSONContent) => editable.value && saver.push({ body });
const onTitle = () => editable.value && saver.push({ title: title.value });
onBeforeUnmount(saver.flush);

const actions = computed<MenuItem[]>(() => [
  {
    id: 'archive',
    label: tx('archive'),
    icon: Archive,
    disabled: !editable.value,
    confirm: { title: tx('archiveTitle'), confirmLabel: tx('archive') },
    onSelect: archive,
  },
]);

async function archive() {
  saver.flush();
  await mutate('docs.page.archive', { id: props.pageId });
  void router.push('/m/docs');
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8 md:px-6">
    <p v-if="page === undefined" class="text-fg-muted" />
    <p v-else-if="!page" class="text-fg-muted">{{ tx('notFound') }}</p>
    <template v-else>
      <div
        v-if="holder"
        role="status"
        data-testid="doc-lock"
        class="flex items-center gap-2 rounded-md bg-accent-subtle px-3 py-2 text-sm text-fg"
      >
        <Lock :size="14" />{{ holder }}
      </div>
      <div class="flex items-center gap-2">
        <h1 class="min-w-0 flex-1 text-xl font-semibold">
          <input
            v-model="title"
            :aria-label="tx('title')"
            :placeholder="tx('untitled')"
            :disabled="!editable"
            data-testid="doc-title"
            class="h-11 w-full rounded-md bg-transparent px-2 font-[inherit] outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus md:h-12"
            @input="onTitle"
          />
        </h1>
        <Menu :items="actions" :label="tx('actions')" align="end" />
      </div>
      <DocEditor
        :model-value="page.body as JSONContent"
        :members="members"
        :editable="editable"
        @update:model-value="onBody"
        @open-task="(k) => router.push(`/t/${k}`)"
      />
    </template>
  </div>
</template>
