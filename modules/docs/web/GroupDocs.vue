<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { FileText } from 'lucide-vue-next';
import { EmptyState, useGroupLevels, type GroupScope } from '@planar/web/modules';
import PageTree from './PageTree.vue';
import PageView from './PageView.vue';
import { useTexts } from './text';

// таб «Документы» группы: страницы её уровня и вложенных, страница — в ?page
const props = defineProps<{ scope: GroupScope }>();
const tx = useTexts();
const route = useRoute();
const levels = useGroupLevels(() => props.scope);
const sections = computed(() =>
  levels.value.map((l, i) => ({
    key: l.key,
    title: l.title,
    spaceId: l.spaceId,
    projectId: l.projectId,
    optional: i > 0,
    indent: l.level === 'project' && props.scope.level !== 'project',
  })),
);
const pageId = computed(() => (typeof route.query.page === 'string' ? route.query.page : ''));
const link = (id: string) => ({ query: { ...route.query, page: id } });
</script>

<template>
  <div class="flex h-full min-h-0" data-testid="group-docs">
    <nav
      :aria-label="tx('docs')"
      class="w-64 shrink-0 overflow-y-auto border-r border-border py-2 max-md:hidden"
    >
      <PageTree :sections="sections" :link="link" :current="pageId" />
    </nav>
    <div class="min-w-0 flex-1 overflow-y-auto">
      <PageView
        v-if="pageId"
        :key="pageId"
        :page-id="pageId"
        :back="{ query: { ...route.query, page: undefined } }"
      />
      <EmptyState v-else :icon="FileText" :title="tx('pickHere')" />
    </div>
  </div>
</template>
