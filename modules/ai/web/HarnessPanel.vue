<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, db, Dialog, useQuery } from '@planar/web/modules';
import { tr } from './data';
import { isPackPage } from './harnessUi';
import HarnessDiff from './HarnessDiff.vue';

// Panel under the title of a pack document (docPanels): diff → confirm → apply (admin of the project; the API answers 403 otherwise)
const props = defineProps<{ pageId: string; projectId?: string | null }>();
type Row = { id: string; parentId: string | null; title: string; projectId?: string | null };
const pages = useQuery(async () => {
  const out: Row[] = [];
  let id: string | null = props.pageId;
  for (let i = 0; id && i < 3; i++) {
    const p: Row | undefined = await db.table<Row>('docsPages').get(id);
    if (!p) break;
    out.push(p);
    id = p.parentId;
  }
  return out;
});
const show = computed(() => !!props.projectId && isPackPage(pages.value ?? [], props.pageId));

const open = ref(false);
const done = ref(false);
const start = () => {
  done.value = false;
  open.value = true;
};
const applied = () => {
  open.value = false;
  done.value = true;
};
</script>

<template>
  <div v-if="show" class="flex items-center gap-3" data-testid="harness-panel">
    <Button size="sm" data-testid="harness-apply" @click="start">{{ tr('applyHarness') }}</Button>
    <span v-if="done" class="text-sm text-fg-muted" data-testid="harness-done">{{
      tr('applied')
    }}</span>
    <Dialog v-model:open="open" :title="tr('applyHarness')" size="lg">
      <HarnessDiff v-if="open" :project-id="projectId!" :pack-page-id="pageId" @applied="applied" />
    </Dialog>
  </div>
</template>
