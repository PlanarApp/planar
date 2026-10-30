<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronRight } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { db, useQuery } from '@planar/web/modules';
import PageTree from './PageTree.vue';
import { useTexts } from './text';

const tx = useTexts();
const route = useRoute();
const spaces = useQuery(async () =>
  (await db.table<Row<'spaces'>>('spaces').toArray()).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
// the section's collapsed state — its own state, not part of the core UI
const KEY = 'planar.sidebar.docs';
const folded = ref(false);
try {
  folded.value = localStorage.getItem(KEY) === '1';
} catch {
  /* without storage — until reload */
}
const fold = () => {
  folded.value = !folded.value;
  try {
    localStorage.setItem(KEY, folded.value ? '1' : '0');
  } catch {
    /* see above */
  }
};
const sections = computed(() =>
  (spaces.value ?? []).map((s) => ({ key: s.id, title: s.name, spaceId: s.id })),
);
const link = (id: string) => `/m/docs/${id}`;
</script>

<template>
  <section data-testid="docs-tree">
    <h2>
      <button
        type="button"
        :aria-expanded="!folded"
        class="flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs font-medium uppercase text-fg-muted outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        @click="fold"
      >
        <ChevronRight :size="12" :class="['shrink-0 transition-transform', !folded && 'rotate-90']" />{{
          tx('docs')
        }}
      </button>
    </h2>
    <PageTree
      v-if="!folded"
      :sections="sections"
      :link="link"
      :current="route.params.pageId as string | undefined"
    />
  </section>
</template>
