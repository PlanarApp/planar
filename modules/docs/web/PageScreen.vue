<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FileText } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { Button, EmptyState, db, mutate, newId, rankBetween, useQuery } from '@planar/web/modules';
import PageView from './PageView.vue';
import { useTexts } from './text';

const KEY = 'planar.docs.last';
const route = useRoute();
const router = useRouter();
const tx = useTexts();
const pageId = computed(() => (route.params.pageId as string | undefined) || '');

// /m/docs без страницы — последняя открытая, если она ещё есть
watch(
  pageId,
  async (id) => {
    try {
      if (id) return localStorage.setItem(KEY, id);
      const last = localStorage.getItem(KEY);
      if (last && (await db.table('docsPages').get(last))) void router.replace(`/m/docs/${last}`);
    } catch {
      /* хранилище недоступно */
    }
  },
  { immediate: true },
);

const spaces = useQuery(async () =>
  (await db.table<Row<'spaces'>>('spaces').toArray()).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
const pages = useQuery(() => db.table('docsPages').toArray());
const none = computed(() => !!pages.value && !pages.value.some((p) => !p.archivedAt));
async function create() {
  const spaceId = spaces.value?.[0]?.id;
  if (!spaceId) return;
  const id = newId();
  await mutate('docs.page.create', { id, spaceId, parentId: null, rank: rankBetween(null, null) });
  void router.push(`/m/docs/${id}`);
}
</script>

<template>
  <PageView v-if="pageId" :key="pageId" :page-id="pageId" />
  <EmptyState v-else-if="none" :icon="FileText" :title="tx('noPages')">
    <template v-if="spaces?.length" #actions>
      <Button variant="primary" @click="create">{{ tx('newPage') }}</Button>
    </template>
  </EmptyState>
  <EmptyState v-else :icon="FileText" :title="tx('pick')" />
</template>
