<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useStatuses } from '../queries';
import OptionPicker from './OptionPicker.vue';
import StatusIcon from './StatusIcon.vue';

// several statuses of the project (automation triggers, PLNRAPP-197); ids not of the project stay selected
const props = defineProps<{
  spaceId: string;
  projectId: string;
  title?: string;
  /** button text when nothing is selected */
  empty?: string;
}>();
const model = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const statuses = useStatuses(
  () => props.spaceId,
  () => props.projectId,
);
const options = computed(() =>
  (statuses.value ?? []).map((s) => ({
    id: s.id,
    label: s.name,
    icon: StatusIcon,
    iconProps: { status: s },
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
    :title="title ?? t('tasks.status')"
    :empty="empty"
    @pick="toggle"
  />
</template>
