<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Archive } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { db, mutate, useQuery, Button } from '@planar/web/modules';
import DocEditor from './DocEditor.vue';
import type { PageFull } from './model';
import { createSaver } from './save';
import { useTexts } from './text';

const props = defineProps<{ pageId: string }>();
const tx = useTexts();
const router = useRouter();
const page = useQuery(() => db.table<PageFull>('docsPages').get(props.pageId));
const users = useQuery(() => db.table<Row<'users'>>('users').toArray());
const members = computed(() => (users.value ?? []).map((u) => ({ id: u.id, name: u.name })));
const title = ref('');
// заголовок берём из реплики один раз; дальше его ведёт поле
const seeded = ref(false);
watch(
  page,
  (p) => {
    if (p && !seeded.value) title.value = p.title;
    if (p) seeded.value = true;
  },
  { immediate: true },
);

const saver = createSaver<{ title?: string }>((patch) =>
  mutate('docs.page.update', { id: props.pageId, ...patch }).catch(() => {}),
);
const onTitle = () => saver.push({ title: title.value });
onBeforeUnmount(saver.flush);

async function archive() {
  saver.flush();
  await mutate('docs.page.archive', { id: props.pageId });
  void router.push('/m/docs');
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 md:p-6">
    <p v-if="page === undefined" class="text-fg-muted" />
    <p v-else-if="!page" class="text-fg-muted">{{ tx('notFound') }}</p>
    <template v-else>
      <div class="flex items-center gap-2">
        <input
          v-model="title"
          :aria-label="tx('title')"
          :placeholder="tx('untitled')"
          data-testid="doc-title"
          class="h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 text-2xl font-semibold outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus md:h-12"
          @input="onTitle"
        />
        <Button variant="ghost" size="sm" :icon="Archive" @click="archive">
          {{ tx('archive') }}
        </Button>
      </div>
      <DocEditor
        :name="`docs:${pageId}`"
        :members="members"
        @open-task="(k) => router.push(`/t/${k}`)"
      />
    </template>
  </div>
</template>
