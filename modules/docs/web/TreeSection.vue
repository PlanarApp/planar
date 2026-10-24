<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ChevronRight, FileText, Plus } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { db, mutate, newId, rankBetween, useQuery } from '@planar/web/modules';
import { buildTree, moveArgs, type DropZone, type PageRow, type TreeNode } from './model';
import { useTexts } from './text';

const tx = useTexts();
const route = useRoute();
const router = useRouter();
const pages = useQuery(() => db.table<PageRow>('docsPages').toArray());
const spaces = useQuery(async () =>
  (await db.table<Row<'spaces'>>('spaces').toArray()).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
// свёрнутость — общее хранилище боковой панели (provide из ядра); без него — локально
const sc = inject<{ is: (id: string) => boolean; toggle: (id: string) => void }>(
  'planar.sidebar.collapse',
  (() => {
    const off = ref(false);
    return { is: () => off.value, toggle: () => (off.value = !off.value) };
  })(),
);
const opened = ref(new Set<string>());
const current = computed(() => route.params.pageId as string | undefined);

// путь до открытой страницы раскрыт всегда
const trail = computed(() => {
  const out = new Set<string>();
  const all = pages.value ?? [];
  for (let p = all.find((x) => x.id === current.value); p?.parentId; ) {
    out.add(p.parentId);
    p = all.find((x) => x.id === p!.parentId);
  }
  return out;
});
const open = computed(() => new Set([...opened.value, ...trail.value]));
const trees = computed(() =>
  (spaces.value ?? []).map((s) => ({
    s,
    rows: buildTree(pages.value ?? [], s.id, open.value),
    // есть ли дети — показывать шеврон
    parents: new Set((pages.value ?? []).filter((p) => !p.archivedAt).map((p) => p.parentId)),
  })),
);
const toggle = (id: string) => {
  const s = new Set(opened.value);
  if (!s.delete(id)) s.add(id);
  opened.value = s;
};

async function add(spaceId: string, parent: PageRow | null) {
  const sib = (pages.value ?? [])
    .filter((p) => p.spaceId === spaceId && p.parentId === (parent?.id ?? null) && !p.archivedAt)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1));
  const id = newId();
  await mutate('docs.page.create', {
    id,
    spaceId,
    parentId: parent?.id ?? null,
    rank: rankBetween(sib.at(-1)?.rank ?? null, null),
  });
  if (parent) opened.value = new Set(opened.value).add(parent.id);
  void router.push(`/m/docs/${id}`);
}

// перетаскивание: верх строки — перед, низ — после, середина — внутрь
const dragId = ref('');
const hint = ref<{ id: string; zone: DropZone } | null>(null);
const zoneOf = (e: DragEvent): DropZone => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (e.clientY - r.top) / (r.height || 1);
  return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
};
function drop(e: DragEvent, n: TreeNode) {
  const zone = zoneOf(e);
  hint.value = null;
  const a = dragId.value && moveArgs(pages.value ?? [], dragId.value, n.page.id, zone);
  dragId.value = '';
  if (a) void mutate('docs.page.move', a).catch(() => {});
}
</script>

<template>
  <section data-testid="docs-tree">
    <h2>
      <button
        type="button"
        :aria-expanded="!sc.is('docs')"
        class="flex h-7 w-full items-center gap-1 rounded-md px-2 text-sm text-fg outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        @click="sc.toggle('docs')"
      >
        <ChevronRight :size="12" :class="['shrink-0', !sc.is('docs') && 'rotate-90']" />{{
          tx('docs')
        }}
      </button>
    </h2>
    <template v-if="!sc.is('docs')">
    <div v-for="t in trees" :key="t.s.id">
      <div class="group flex h-7 items-center px-2 text-xs text-fg-muted">
        <span class="truncate">{{ t.s.name }}</span>
        <button
          type="button"
          :aria-label="tx('newPage')"
          :title="tx('newPage')"
          class="ml-auto rounded-sm p-1 hover:bg-bg-muted"
          @click="add(t.s.id, null)"
        >
          <Plus :size="14" />
        </button>
      </div>
      <div
        v-for="n in t.rows"
        :key="n.page.id"
        draggable="true"
        :style="{ paddingLeft: n.depth * 12 + 'px' }"
        :class="[
          'group flex h-7 items-center rounded-md hover:bg-bg-muted',
          current === n.page.id && 'bg-accent-subtle',
          hint?.id === n.page.id && hint.zone === 'into' && 'ring-2 ring-focus',
          hint?.id === n.page.id && hint.zone === 'before' && 'border-t-2 border-accent',
          hint?.id === n.page.id && hint.zone === 'after' && 'border-b-2 border-accent',
        ]"
        @dragstart="dragId = n.page.id"
        @dragend="((dragId = ''), (hint = null))"
        @dragover.prevent="hint = { id: n.page.id, zone: zoneOf($event) }"
        @drop.prevent="drop($event, n)"
      >
        <button
          v-if="t.parents.has(n.page.id)"
          type="button"
          :aria-label="tx('expand')"
          :aria-expanded="open.has(n.page.id)"
          class="rounded-sm p-1"
          @click="toggle(n.page.id)"
        >
          <ChevronRight :size="12" :class="open.has(n.page.id) && 'rotate-90'" />
        </button>
        <span v-else class="w-5 shrink-0" />
        <RouterLink
          :to="`/m/docs/${n.page.id}`"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-fg outline-none focus-visible:ring-2 ring-focus"
        >
          <span v-if="n.page.icon" aria-hidden="true">{{ n.page.icon }}</span>
          <FileText v-else :size="14" class="shrink-0 text-fg-subtle" />
          <span class="truncate">{{ n.page.title || tx('untitled') }}</span>
        </RouterLink>
        <button
          type="button"
          :aria-label="tx('newPage')"
          class="mr-1 rounded-sm p-1 opacity-0 hover:bg-bg group-hover:opacity-100 focus-visible:opacity-100"
          @click="add(n.page.spaceId, n.page)"
        >
          <Plus :size="12" />
        </button>
      </div>
    </div>
    </template>
  </section>
</template>
