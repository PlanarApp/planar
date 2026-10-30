<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { Archive, Star, StarOff } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { db, favorites, i18n, mutate, useQuery, Menu, type MenuItem } from '@planar/web/modules';
import DocEditor from './DocEditor.vue';
import type { PageFull } from './model';
import { createSaver } from './save';
import { useTexts } from './text';

// back — куда уйти после архивации (в табе группы — та же группа без ?page)
const props = defineProps<{ pageId: string; back?: RouteLocationRaw }>();
const tx = useTexts();
const router = useRouter();
const route = useRoute();
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

const fav = computed(() => favorites.has('doc', props.pageId));
const actions = computed<MenuItem[]>(() => [
  {
    id: 'fav',
    label: i18n.global.t(fav.value ? 'sidebar.unfavorite' : 'sidebar.favorite'),
    icon: fav.value ? StarOff : Star,
    // ссылка — текущий адрес страницы (в табе группы или в модуле)
    onSelect: () =>
      favorites.toggle({
        kind: 'doc',
        id: props.pageId,
        name: title.value || tx('untitled'),
        to: route.fullPath,
      }),
  },
  {
    id: 'archive',
    label: tx('archive'),
    icon: Archive,
    confirm: { title: tx('archiveTitle'), confirmLabel: tx('archive') },
    onSelect: archive,
  },
]);

async function archive() {
  saver.flush();
  await mutate('docs.page.archive', { id: props.pageId });
  void router.push(props.back ?? '/m/docs');
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8 md:px-6">
    <p v-if="page === undefined" class="text-fg-muted" />
    <p v-else-if="!page" class="text-fg-muted">{{ tx('notFound') }}</p>
    <template v-else>
      <div class="flex items-center gap-2">
        <h1 class="min-w-0 flex-1 text-xl font-semibold">
          <input
            v-model="title"
            :aria-label="tx('title')"
            :placeholder="tx('untitled')"
            data-testid="doc-title"
            class="h-11 w-full rounded-md bg-transparent px-2 font-[inherit] outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus md:h-12"
            @input="onTitle"
          />
        </h1>
        <Menu :items="actions" :label="tx('actions')" align="end" />
      </div>
      <DocEditor
        :name="`docs:${pageId}`"
        :members="members"
        @open-task="(k) => router.push(`/t/${k}`)"
      />
    </template>
  </div>
</template>
