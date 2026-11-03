<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Tag } from 'lucide-vue-next';
import { mutate, newId } from '../../sync';
import { COLORS } from '../../screens/settings/colors';
import { useLabels } from '../queries';
import { uniqByName } from '../dictionaries';
import OptionPicker from './OptionPicker.vue';

// projectId — labels of the task's project; without it (summary, filter) same-named labels are one item
const props = defineProps<{ spaceId: string; projectId?: string; compact?: boolean }>();
const model = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const labels = useLabels(
  () => props.spaceId,
  () => props.projectId,
);
const options = computed(() =>
  (props.projectId ? (labels.value ?? []) : uniqByName(labels.value ?? [])).map((l) => ({
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
// «Create» only for a task's project, when no label of that name exists there
const createText = (q: string) =>
  props.projectId &&
  q &&
  !(labels.value ?? []).some((l) => l.name.toLowerCase() === q.toLowerCase())
    ? t('tasks.createLabel', { name: q })
    : null;
async function create(name: string) {
  const id = newId();
  await mutate('label.create', { id, projectId: props.projectId, name, color: COLORS[0] });
  toggle(id);
}
</script>

<template>
  <OptionPicker
    :options="options"
    :selected="model"
    multiple
    :title="t('tasks.labels')"
    :empty="t('tasks.noLabel')"
    :compact="compact"
    :extra="createText"
    @pick="toggle"
    @extra="create"
  >
    <template v-if="$slots.value" #value><slot name="value" /></template>
  </OptionPicker>
</template>
