<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { Archive, ArrowRightLeft, History, Star, StarOff } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import {
  db,
  favorites,
  i18n,
  mutate,
  useQuery,
  useSession,
  useExtensions,
  Menu,
  type MenuItem,
} from '@planar/web/modules';
import DocEditor from './DocEditor.vue';
import VersionsDialog from './VersionsDialog.vue';
import { toProjectArgs, type PageFull } from './model';
import { createSaver } from './save';
import { useTexts } from './text';

// back — where to go after archiving (in the group's tab — the same group without ?page)
const props = defineProps<{ pageId: string; back?: RouteLocationRaw }>();
const tx = useTexts();
const router = useRouter();
const route = useRoute();
const page = useQuery(() => db.table<PageFull>('docsPages').get(props.pageId));
const users = useQuery(() => db.table<Row<'users'>>('users').toArray());
const members = computed(() => (users.value ?? []).map((u) => ({ id: u.id, name: u.name })));
// panels of other modules under the title (docPanels); each decides itself whether the page suits it
const panelExt = useExtensions('docPanels', () => page.value?.projectId ?? undefined);
const panels = computed(() =>
  panelExt.value.map((p) => ({
    key: p.key,
    view: defineAsyncComponent(() => p.component().then((m) => m.default)),
  })),
);
const title = ref('');
// the title is taken from the replica once; afterwards the field drives it
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
const history = ref(false);
// PLNRAPP-5: move targets — projects and space root of the page's space and other writable spaces
const user = useSession();
const spaces = useQuery(() => db.table<Row<'spaces'>>('spaces').toArray());
const projects = useQuery(() => db.table<Row<'projects'>>('projects').toArray());
const writable = useQuery(async () => {
  const me = user.value?.id ?? '';
  const rows = await db
    .table<Row<'spaceMembers'>>('spaceMembers')
    .where('userId')
    .equals(me)
    .toArray();
  return new Set(rows.filter((m) => m.role !== 'guest').map((m) => m.spaceId));
});
const byRank = <T extends { rank: string }>(a: T, b: T) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
const targets = computed(() => {
  const p = page.value;
  if (!p) return [];
  const live = (projects.value ?? []).filter((x) => !x.archivedAt).sort(byRank);
  const ownProjects = live
    .filter((x) => x.spaceId === p.spaceId)
    .map((x) => ({ spaceId: p.spaceId, projectId: x.id, label: x.name }));
  const own = [
    { spaceId: p.spaceId, projectId: null, label: tx('noProject') },
    ...ownProjects,
  ];
  const others = [...(spaces.value ?? [])]
    .filter((s) => s.id !== p.spaceId && (writable.value?.has(s.id) ?? false))
    .sort(byRank)
    .flatMap((s) => {
      const spaceProjects = live
        .filter((x) => x.spaceId === s.id)
        .map((x) => ({ spaceId: s.id, projectId: x.id, label: `${s.name} / ${x.name}` }));
      return [
        { spaceId: s.id, projectId: null, label: `${s.name} / ${tx('noProject')}` },
        ...spaceProjects,
      ];
    });
  return [...own, ...others].map((x) => ({
    id: `${x.spaceId}:${x.projectId ?? 'none'}`,
    label: x.label,
    checked: p.spaceId === x.spaceId && (p.projectId ?? null) === x.projectId,
    onSelect: () =>
      (p.spaceId !== x.spaceId || (p.projectId ?? null) !== x.projectId) &&
      void moveTo(x.spaceId, x.projectId),
  }));
});
/** to the end of the target's root pages, with the subpages (docs.page.move) */
async function moveTo(spaceId: string, projectId: string | null) {
  saver.flush();
  const pages = await db
    .table<PageFull>('docsPages')
    .where('spaceId')
    .equals(spaceId)
    .toArray();
  await mutate('docs.page.move', toProjectArgs(pages, props.pageId, projectId, spaceId)).catch(() => {});
}
const actions = computed<MenuItem[]>(() => [
  {
    id: 'fav',
    label: i18n.global.t(fav.value ? 'sidebar.unfavorite' : 'sidebar.favorite'),
    icon: fav.value ? StarOff : Star,
    // link — the current page address (in the group's tab or in the module)
    onSelect: () =>
      favorites.toggle({
        kind: 'doc',
        id: props.pageId,
        name: title.value || tx('untitled'),
        to: route.fullPath,
      }),
  },
  {
    id: 'move',
    label: tx('move'),
    icon: ArrowRightLeft,
    disabled: targets.value.length < 2,
    children: targets.value,
  },
  {
    id: 'history',
    label: tx('history'),
    icon: History,
    onSelect: () => (history.value = true),
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
      <component
        :is="p.view"
        v-for="p in panels"
        :key="p.key"
        :page-id="pageId"
        :project-id="page.projectId"
      />
      <DocEditor
        :name="`docs:${pageId}`"
        :members="members"
        @open-task="(k) => router.push(`/t/${k}`)"
      />
      <VersionsDialog v-if="history" v-model:open="history" :page-id="pageId" />
    </template>
  </div>
</template>
