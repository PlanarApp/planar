<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStatuses } from '../queries';
import OptionPicker from './OptionPicker.vue';
import StatusIcon from './StatusIcon.vue';

const props = defineProps<{ spaceId: string; compact?: boolean }>();
const model = defineModel<string>();
const { t } = useI18n();
const statuses = useStatuses(() => props.spaceId);
const options = computed(() =>
  (statuses.value ?? []).map((s) => ({
    id: s.id,
    label: s.name,
    icon: StatusIcon,
    iconProps: { status: s },
  })),
);
</script>

<template>
  <OptionPicker
    :options="options"
    :selected="model ? [model] : []"
    :title="t('tasks.status')"
    :compact="compact"
    @pick="model = $event"
  />
</template>
