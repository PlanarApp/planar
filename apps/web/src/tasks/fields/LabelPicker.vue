<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Tag } from 'lucide-vue-next';
import { useLabels } from '../queries';
import OptionPicker from './OptionPicker.vue';

const props = defineProps<{ spaceId: string; compact?: boolean }>();
const model = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const labels = useLabels(() => props.spaceId);
const options = computed(() =>
  (labels.value ?? []).map((l) => ({
    id: l.id,
    label: l.name,
    icon: Tag,
    iconProps: { size: 14, style: { color: l.color } },
  })),
);
const toggle = (id: string) =>
  (model.value = model.value.includes(id)
    ? model.value.filter((x) => x !== id)
    : [...model.value, id]);
</script>

<template>
  <OptionPicker
    :options="options"
    :selected="model"
    multiple
    :title="t('tasks.labels')"
    :empty="t('tasks.noLabel')"
    :compact="compact"
    @pick="toggle"
  >
    <template v-if="$slots.value" #value><slot name="value" /></template>
  </OptionPicker>
</template>
