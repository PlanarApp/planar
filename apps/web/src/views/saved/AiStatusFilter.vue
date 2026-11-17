<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Select } from '../../ui';
import { enabledForProject } from '../../modules/registry';
import { AI_STATES } from '../aiFilter';

// PLNRAPP-401: the «AI status» filter of a project view (client-side, by the project's activity); only with the ai module
const props = defineProps<{ projectId: string }>();
const model = defineModel<string | null | undefined>({ default: null });
const { t } = useI18n();
const options = computed(() => [
  { value: 'all', label: t('views.aiFilter.all') },
  ...AI_STATES.map((s) => ({
    value: s,
    label: s === 'none' ? t('views.aiFilter.none') : t(`tasks.aiState.${s}`),
  })),
]);
const value = computed({
  get: () => model.value ?? 'all',
  set: (v: string | null) => (model.value = !v || v === 'all' ? null : v),
});
</script>

<template>
  <div
    v-if="enabledForProject('ai', props.projectId)"
    class="w-36 max-md:w-28"
    data-testid="ai-filter"
  >
    <Select v-model="value" size="sm" :label="t('views.aiFilter.title')" :options="options" />
  </div>
</template>
