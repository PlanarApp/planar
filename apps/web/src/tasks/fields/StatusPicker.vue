<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStatuses } from '../queries';
import { normName, uniqByName } from '../dictionaries';
import OptionPicker from './OptionPicker.vue';
import StatusIcon from './StatusIcon.vue';

// projectId — statuses of the task's project; without it (summary) same-named statuses are one item
const props = defineProps<{ spaceId: string; projectId?: string; compact?: boolean }>();
const model = defineModel<string>();
const { t } = useI18n();
const statuses = useStatuses(
  () => props.spaceId,
  () => props.projectId,
);
const shown = computed(() =>
  props.projectId ? (statuses.value ?? []) : uniqByName(statuses.value ?? []),
);
const selected = computed(() => {
  const cur = statuses.value?.find((s) => s.id === model.value);
  return cur
    ? shown.value
        .filter((s) => s.id === cur.id || normName(s.name) === normName(cur.name))
        .map((s) => s.id)
    : [];
});
const options = computed(() =>
  shown.value.map((s) => ({
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
    :selected="selected"
    :title="t('tasks.status')"
    :compact="compact"
    @pick="model = $event"
  >
    <template v-if="$slots.value" #value><slot name="value" /></template>
  </OptionPicker>
</template>
