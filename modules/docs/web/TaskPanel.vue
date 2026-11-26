<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { FilePlus, FileText, X } from '@lucide/vue';
import type { Row } from '@planar/shared';
import { Button, DocPicker, IconButton, db, useQuery, type SearchHit } from '@planar/web/modules';
import { pagePath, searchPages, type PageRow, type TaskLinkRow } from './model';
import { createForTask, link, unlink } from './links';
import { useTexts } from './text';

const props = defineProps<{ taskId: string }>();
const tx = useTexts();
const router = useRouter();
const data = useQuery(async () => {
  const task = await db.table<Row<'tasks'>>('tasks').get(props.taskId);
  const links = await db
    .table<TaskLinkRow>('docsTaskLinks')
    .where('taskId')
    .equals(props.taskId)
    .toArray();
  const linkIds = new Set(links.map((l) => l.pageId));
  // PLNRAPP-826: an archived page stays in the tab (struck through); a deleted one takes its links with it
  const linkedPages = (
    await Promise.all([...linkIds].map((id) => db.table<PageRow>('docsPages').get(id)))
  ).filter((p): p is PageRow => !!p);
  const spacePages = task
    ? await db.table<PageRow>('docsPages').where('spaceId').equals(task.spaceId).toArray()
    : [];
  const ownPages = spacePages.filter((p) => !p.archivedAt && !linkIds.has(p.id));
  // search results show where the page lives: «Space / Project / parents»
  const space = task ? await db.table<{ id: string; name: string }>('spaces').get(task.spaceId) : undefined;
  const projectIds = [...new Set(ownPages.map((p) => p.projectId).filter((x): x is string => !!x))];
  const projects = await db.table<{ id: string; name: string }>('projects').bulkGet(projectIds);
  const projectNames = new Map(projects.filter((x) => !!x).map((x) => [x!.id, x!.name]));
  const byId = new Map(spacePages.map((p) => [p.id, p]));
  return { linked: linkedPages, available: ownPages, spaceName: space?.name ?? '', projectNames, byId };
});
const linked = computed(() => data.value?.linked ?? []);
const q = ref('');
// PLNRAPP-827: the common DocPicker, narrowed to the task's space without the already linked pages;
// a new function on new data — the picker searches again
const search = computed(() => {
  const d = data.value;
  const untitled = tx('untitled');
  return async (query: string, limit: number): Promise<SearchHit[]> =>
    searchPages(d?.available ?? [], query, Math.min(limit, 6)).map((p) => ({
      id: p.id,
      title: p.title || untitled,
      path:
        [d?.spaceName, pagePath(d!.byId, p, d!.projectNames, untitled)].filter(Boolean).join(' / ') ||
        undefined,
      to: `/m/docs/${p.id}`,
    }));
});

async function pick(p: SearchHit) {
  q.value = '';
  await link(p.id, props.taskId);
}
async function create() {
  const id = await createForTask(props.taskId);
  if (id) void router.push(`/m/docs/${id}`);
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="docs-panel">
    <ul v-if="linked.length" class="flex flex-col gap-0.5">
      <li v-for="p in linked" :key="p.id" class="flex items-center gap-1 rounded-md hover:bg-bg-muted">
        <RouterLink :to="`/m/docs/${p.id}`" class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-base">
          <FileText :size="14" class="shrink-0 text-fg-subtle" />
          <span
            class="truncate"
            :class="p.archivedAt && 'text-fg-subtle line-through'"
            :title="p.archivedAt ? tx('archived') : undefined"
            :data-archived="p.archivedAt ? '' : undefined"
            >{{ p.title || tx('untitled') }}</span
          >
        </RouterLink>
        <IconButton :icon="X" :label="tx('unlink')" size="sm" @click="unlink(p.id, taskId)" />
      </li>
    </ul>
    <p v-else class="px-2 text-sm text-fg-subtle">{{ tx('noLinks') }}</p>
    <div class="flex items-start gap-2">
      <DocPicker
        v-model:query="q"
        :search="search"
        :label="tx('link')"
        input-testid="docs-panel-search"
        class="min-w-0 flex-1"
        @pick="pick"
      />
      <Button size="sm" :icon="FilePlus" @click="create">{{ tx('createFromTask') }}</Button>
    </div>
  </div>
</template>
