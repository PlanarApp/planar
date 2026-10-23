<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { db } from '@planar/web/modules';
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
</script>

<template>
  <PageView v-if="pageId" :key="pageId" :page-id="pageId" />
  <p v-else class="p-6 text-fg-muted">{{ tx('pick') }}</p>
</template>
