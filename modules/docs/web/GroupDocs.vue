<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronLeft, FileText } from 'lucide-vue-next';
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
    <!-- мобильная: без выбранной страницы — дерево на весь экран, со страницей — она и «назад» к дереву -->
    <nav
      :aria-label="tx('docs')"
      :class="[
        'w-64 shrink-0 overflow-y-auto border-r border-border py-2',
        pageId ? 'max-md:hidden' : 'max-md:w-full max-md:border-r-0',
      ]"
      data-testid="docs-nav"
    >
      <PageTree :sections="sections" :link="link" :current="pageId" />
    </nav>
    <div :class="['min-w-0 flex-1 overflow-y-auto', !pageId && 'max-md:hidden']">
      <RouterLink
        v-if="pageId"
        :to="{ query: { ...route.query, page: undefined } }"
        class="flex h-10 items-center gap-1 border-b border-border px-2 text-sm text-fg-muted md:hidden"
        data-testid="docs-back"
        ><ChevronLeft :size="18" aria-hidden="true" />{{ tx('docs') }}</RouterLink
      >
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
