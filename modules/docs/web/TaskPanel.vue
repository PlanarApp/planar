<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { FilePlus, FileText, X } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { Button, IconButton, Input, db, useQuery } from '@planar/web/modules';
import { searchPages, type PageRow, type TaskLinkRow } from './model';
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
  const linkedPages = (
    await Promise.all([...linkIds].map((id) => db.table<PageRow>('docsPages').get(id)))
  ).filter((p): p is PageRow => !!p && !p.archivedAt);
  const ownPages = task
    ? (await db.table<PageRow>('docsPages').where('spaceId').equals(task.spaceId).toArray()).filter(
        (p) => !p.archivedAt && !linkIds.has(p.id),
      )
    : [];
  return { linked: linkedPages, available: ownPages };
});
const linked = computed(() => data.value?.linked ?? []);
const q = ref('');
const found = computed(() =>
  q.value.trim() ? searchPages(data.value?.available ?? [], q.value, 6) : [],
);

async function pick(p: PageRow) {
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
          <span class="truncate">{{ p.title || tx('untitled') }}</span>
        </RouterLink>
        <IconButton :icon="X" :label="tx('unlink')" size="sm" @click="unlink(p.id, taskId)" />
      </li>
    </ul>
    <p v-else class="px-2 text-sm text-fg-subtle">{{ tx('noLinks') }}</p>
    <div class="relative flex items-center gap-2">
      <Input v-model="q" :label="tx('link')" hide-label :placeholder="tx('link')" class="min-w-0 flex-1" />
      <Button size="sm" :icon="FilePlus" @click="create">{{ tx('createFromTask') }}</Button>
      <ul
        v-if="found.length"
        role="listbox"
        class="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border bg-surface p-1 shadow-md"
      >
        <li
          v-for="p in found"
          :key="p.id"
          role="option"
          class="flex h-8 cursor-default items-center rounded-sm px-2 text-base hover:bg-bg-muted"
          @mousedown.prevent="pick(p)"
        >
          {{ p.title || tx('untitled') }}
        </li>
      </ul>
    </div>
  </div>
</template>
