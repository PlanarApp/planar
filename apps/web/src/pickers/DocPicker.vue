<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { FileText } from 'lucide-vue-next';
import { useExtensions } from '../modules/registry';
import type { SearchHit } from '../modules/types';
import PickList from './PickList.vue';

/**
 * The one document picker (PLNRAPP-827): search through the docs module's provider (no module import into
 * the core), every page with its path. Without the module the list stays empty — see `useDocsPickable`.
 * `search` replaces the provider when a place narrows the pages (the task's «Документы» tab: its space, not linked).
 */
const props = withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    limit?: number;
    autofocus?: boolean;
    inputTestid?: string;
    optionTestid?: string;
    search?: (q: string, limit: number) => Promise<SearchHit[]>;
  }>(),
  { limit: 20 },
);
const emit = defineEmits<{ pick: [doc: SearchHit]; key: [e: KeyboardEvent] }>();
const q = defineModel<string>('query', { default: '' });
const { t } = useI18n();
const providers = useExtensions('search');
const provider = computed(
  () => props.search ?? providers.value.find((p) => p.moduleId === 'docs')?.search,
);
const hits = ref<SearchHit[]>([]);
let seq = 0;
watch(
  [q, provider],
  async () => {
    const n = ++seq;
    const r = q.value.trim() && provider.value ? await provider.value(q.value, props.limit) : [];
    if (n === seq) hits.value = r;
  },
  { immediate: true },
);
const rows = computed(() => hits.value.map((h) => ({ id: h.id, title: h.title, path: h.path })));
const list = ref<InstanceType<typeof PickList> | null>(null);
defineExpose({ focus: () => list.value?.focus() });
</script>

<template>
  <PickList
    ref="list"
    v-model:query="q"
    :rows="rows"
    :label="label ?? t('pickers.docSearch')"
    :none="t('pickers.noDocs')"
    :hint="hint"
    :icon="FileText"
    :autofocus="autofocus"
    :input-testid="inputTestid"
    :option-testid="optionTestid"
    @pick="
      (id) =>
        emit(
          'pick',
          hits.find((h) => h.id === id)!,
        )
    "
    @key="emit('key', $event)"
  />
</template>
