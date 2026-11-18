<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import {
  Archive,
  ArrowRightLeft,
  History,
  MessageSquare,
  Star,
  StarOff,
} from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import {
  db,
  favorites,
  i18n,
  mutate,
  useQuery,
  useSession,
  useExtensions,
  useBreakpoint,
  Dialog,
  Menu,
  type MenuItem,
} from '@planar/web/modules';
import DocComments from './DocComments.vue';
import DocEditor from './DocEditor.vue';
import VersionsDialog from './VersionsDialog.vue';
import { toProjectArgs, type PageFull } from './model';
import type { CommentRow } from './comments';
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

// PLNRAPP-231: the document menu — desktop: tabs on the right, the active one opens its panel next
// to the text; mobile: fixed FAB buttons in the same corner, a panel opens as a dialog.
// So far one tab — comments; a link to a comment (?comment=<id>) opens it right away
const { isMobile } = useBreakpoint();
const tabs = [{ id: 'comments', label: tx('comments'), icon: MessageSquare }] as const;
type Tab = (typeof tabs)[number]['id'];
const linked = typeof route?.query.comment === 'string';
const panel = ref<Tab | null>(isMobile.value && !linked ? null : 'comments');
const toggle = (t: Tab) => (panel.value = panel.value === t ? null : t);
const commentCount = useQuery(() =>
  db.table<CommentRow>('docsComments').where('pageId').equals(props.pageId).count(),
);
const badge = (t: Tab) => (t === 'comments' ? commentCount.value || 0 : 0);
// the mobile dialog: open — the panel is set, close — the panel is dropped
const dialog = computed({
  get: () => isMobile.value && panel.value !== null,
  set: (v: boolean) => {
    if (!v) panel.value = null;
  },
});

async function archive() {
  saver.flush();
  await mutate('docs.page.archive', { id: props.pageId });
  void router.push(props.back ?? '/m/docs');
}
</script>

<template>
  <p v-if="page === undefined" class="text-fg-muted" />
  <p v-else-if="!page" class="mx-auto max-w-3xl px-4 py-8 text-fg-muted md:px-6">
    {{ tx('notFound') }}
  </p>
  <div v-else class="flex h-full min-h-0 flex-1">
    <div class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8 pb-24 md:px-6 md:pb-8">
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
      </div>
    </div>
    <!-- desktop: the comments panel and the vertical tabs on the right -->
    <aside
      v-if="!isMobile && panel === 'comments'"
      class="w-80 shrink-0 overflow-y-auto border-l border-border px-4 pb-6 lg:w-96"
      data-testid="doc-panel"
    >
      <DocComments
        :key="pageId"
        :page-id="pageId"
        :space-id="page.spaceId"
        :project-id="page.projectId"
      />
    </aside>
    <div
      v-if="!isMobile"
      role="tablist"
      aria-orientation="vertical"
      :aria-label="tx('docMenu')"
      class="flex shrink-0 flex-col gap-1 border-l border-border p-1"
      data-testid="doc-menu"
    >
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="panel === t.id"
        :aria-label="t.label"
        :title="t.label"
        :data-tab="t.id"
        :class="[
          'relative inline-flex size-9 items-center justify-center rounded-md text-fg-muted outline-none hover:bg-bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus',
          panel === t.id && 'bg-bg-muted text-fg',
        ]"
        @click="toggle(t.id)"
      >
        <component :is="t.icon" :size="18" aria-hidden="true" />
        <span
          v-if="badge(t.id)"
          class="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] leading-4 text-accent-fg"
          >{{ badge(t.id) }}</span
        >
      </button>
    </div>
    <!-- mobile: fixed FAB buttons in the same corner, the panel — a dialog -->
    <div
      v-else
      class="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-30 flex flex-col gap-2"
      :aria-label="tx('docMenu')"
      role="group"
      data-testid="doc-menu"
    >
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        :aria-label="t.label"
        :data-tab="t.id"
        class="relative inline-flex size-12 items-center justify-center rounded-full border border-border bg-surface text-fg shadow-lg outline-none focus-visible:outline-2 focus-visible:outline-focus"
        @click="panel = t.id"
      >
        <component :is="t.icon" :size="20" aria-hidden="true" />
        <span
          v-if="badge(t.id)"
          class="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent px-1 text-xs leading-5 text-accent-fg"
          >{{ badge(t.id) }}</span
        >
      </button>
    </div>
    <Dialog v-if="isMobile" v-model:open="dialog" :title="tx('comments')">
      <DocComments
        :key="pageId"
        :page-id="pageId"
        :space-id="page.spaceId"
        :project-id="page.projectId"
      />
    </Dialog>
    <VersionsDialog v-if="history" v-model:open="history" :page-id="pageId" />
  </div>
</template>
