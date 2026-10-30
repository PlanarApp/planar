<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router';
import { ChevronRight, FileText, Plus } from 'lucide-vue-next';
import { IconButton, db, mutate, newId, rankBetween, useQuery } from '@planar/web/modules';
import { buildTree, moveArgs, type DropZone, type PageRow, type TreeNode } from './model';
import { useTexts } from './text';

/** Раздел дерева — уровень группы; projectId: undefined — все страницы пространства. */
export interface TreeSectionDef {
  key: string;
  title?: string;
  spaceId: string;
  projectId?: string | null;
  /** скрыть раздел без страниц (вложенные уровни в табе группы) */
  optional?: boolean;
  /** отступ заголовка: проект под пространством */
  indent?: boolean;
}
const props = defineProps<{
  sections: TreeSectionDef[];
  link: (pageId: string) => RouteLocationRaw;
  current?: string;
}>();
const tx = useTexts();
const router = useRouter();
const pages = useQuery(() => db.table<PageRow>('docsPages').toArray());
const opened = ref(new Set<string>());

// путь до открытой страницы раскрыт всегда
const trail = computed(() => {
  const out = new Set<string>();
  const all = pages.value ?? [];
  for (let p = all.find((x) => x.id === props.current); p?.parentId;) {
    out.add(p.parentId);
    p = all.find((x) => x.id === p!.parentId);
  }
  return out;
});
const open = computed(() => new Set([...opened.value, ...trail.value]));
const inSection = (s: TreeSectionDef) => (p: PageRow) =>
  s.projectId === undefined || (p.projectId ?? null) === s.projectId;
const trees = computed(() => {
  // есть ли дети — показывать шеврон
  const parents = new Set((pages.value ?? []).filter((p) => !p.archivedAt).map((p) => p.parentId));
  return props.sections
    .map((s) => ({
      s,
      rows: buildTree((pages.value ?? []).filter(inSection(s)), s.spaceId, open.value),
      parents,
    }))
    .filter((t) => t.rows.length || !t.s.optional);
});
const toggle = (id: string) => {
  const s = new Set(opened.value);
  if (!s.delete(id)) s.add(id);
  opened.value = s;
};

async function add(sec: TreeSectionDef, parent: PageRow | null) {
  const sib = (pages.value ?? [])
    .filter(
      (p) =>
        p.spaceId === sec.spaceId &&
        p.parentId === (parent?.id ?? null) &&
        !p.archivedAt &&
        inSection(sec)(p),
    )
    .sort((a, b) => (a.rank < b.rank ? -1 : 1));
  const id = newId();
  await mutate('docs.page.create', {
    id,
    spaceId: sec.spaceId,
    projectId: sec.projectId ?? null,
    parentId: parent?.id ?? null,
    rank: rankBetween(sib.at(-1)?.rank ?? null, null),
  });
  if (parent) opened.value = new Set(opened.value).add(parent.id);
  void router.push(props.link(id));
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
  // рядом с чужой страницей в корне — на её уровень (проект или пространство)
  if (a)
    void mutate('docs.page.move', { ...a, projectId: n.page.projectId ?? null }).catch(() => {});
}
</script>

<template>
  <div v-for="t in trees" :key="t.s.key">
    <div
      v-if="t.s.title !== undefined"
      :class="[
        'group flex h-7 items-center pr-2 text-xs text-fg-muted',
        t.s.indent ? 'pl-8' : 'pl-4',
      ]"
    >
      <span class="truncate">{{ t.s.title }}</span>
      <IconButton
        :icon="Plus"
        :label="tx('newPage')"
        size="sm"
        class="ml-auto md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        @click="add(t.s, null)"
      />
    </div>
    <div
      v-for="n in t.rows"
      :key="n.page.id"
      draggable="true"
      :style="{ paddingLeft: 24 + n.depth * 12 + 'px' }"
      :class="[
        'group flex h-7 max-md:h-10 items-center rounded-md hover:bg-bg-muted',
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
        :to="link(n.page.id)"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-fg outline-none focus-visible:ring-2 ring-focus"
      >
        <span v-if="n.page.icon" aria-hidden="true">{{ n.page.icon }}</span>
        <FileText v-else :size="14" class="shrink-0 text-fg-subtle" />
        <span class="truncate">{{ n.page.title || tx('untitled') }}</span>
      </RouterLink>
      <IconButton
        :icon="Plus"
        :label="tx('newPage')"
        size="sm"
        class="mr-1 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        @click="add(t.s, n.page)"
      />
    </div>
  </div>
</template>
