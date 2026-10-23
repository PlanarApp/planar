<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Avatar } from '../../ui';
import { useMembers } from '../queries';
import OptionPicker from './OptionPicker.vue';

const props = defineProps<{ spaceId: string; compact?: boolean }>();
const model = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const members = useMembers(() => props.spaceId);
const options = computed(() =>
  (members.value ?? []).map((u) => ({
    id: u.id,
    label: u.name,
    icon: Avatar,
    iconProps: { name: u.name, size: 'xs' },
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
    :title="t('tasks.assignee')"
    :empty="t('tasks.noAssignee')"
    :compact="compact"
    @pick="toggle"
  />
</template>
