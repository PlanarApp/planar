<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Dialog, Input } from '../ui';
import { toast } from '../ui/toast';
import { useTaskSearch } from '../links';
import { mergeFrom, mergeTask } from './merge';

// merge a task into another one (PLNRAPP-117): pick the target by title or key, then confirm
const { t } = useI18n();
const from = computed(() => mergeFrom.value!);
const query = ref('');
const target = ref<{ id: string; key: string; title: string } | null>(null);
const busy = ref(false);
const found = useTaskSearch(() => ({
  q: query.value.trim().toLowerCase(),
  space: from.value.spaceId,
  skip: new Set([from.value.id]),
}));
const close = () => (mergeFrom.value = null);
async function merge() {
  if (!target.value) return;
  busy.value = true;
  try {
    await mergeTask(from.value.id, target.value.id);
    toast(t('merge.done', { from: from.value.key, to: target.value.key }), 3000);
    close();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="true"
    size="md"
    :title="t('merge.title', { key: from.key })"
    :description="t('merge.text')"
    @update:open="(o: boolean) => o || close()"
  >
    <Input
      v-model="query"
      :label="t('links.search')"
      hide-label
      :placeholder="t('links.search')"
      data-testid="merge-search"
    />
    <ul class="max-h-[40vh] overflow-y-auto" role="listbox" :aria-label="t('merge.target')">
      <li v-for="f in found" :key="f.id" role="option" :aria-selected="target?.id === f.id">
        <button
          type="button"
          :class="[
            'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-muted md:min-h-8',
            target?.id === f.id && 'bg-bg-muted',
          ]"
          data-testid="merge-candidate"
          @click="target = f"
        >
          <span class="text-xs text-fg-subtle">{{ f.key }}</span>
          <span class="flex-1 truncate">{{ f.title }}</span>
        </button>
      </li>
    </ul>
    <p v-if="target" class="text-sm text-fg-muted">
      {{ t('merge.confirm', { from: from.key, to: target.key }) }}
    </p>
    <template #footer>
      <Button @click="close">{{ t('ui.cancel') }}</Button>
      <Button
        variant="primary"
        :disabled="!target || busy"
        data-testid="merge-confirm"
        @click="merge"
        >{{ t('merge.action') }}</Button
      >
    </template>
  </Dialog>
</template>
