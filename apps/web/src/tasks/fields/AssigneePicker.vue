<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { UserPicker } from '../../pickers';
import { useMembers } from '../queries';

// task assignees: the common user picker over the space members (PLNRAPP-827)
const props = defineProps<{ spaceId: string; compact?: boolean }>();
const model = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const members = useMembers(() => props.spaceId);
const toggle = (id: string | null) =>
  id &&
  (model.value = model.value.includes(id)
    ? model.value.filter((x) => x !== id)
    : [...model.value, id]);
</script>

<template>
  <UserPicker
    :users="members ?? []"
    :selected="model"
    multiple
    :title="t('tasks.assignee')"
    :empty="t('tasks.noAssignee')"
    :compact="compact"
    @pick="toggle"
  >
    <template v-if="$slots.value" #value><slot name="value" /></template>
  </UserPicker>
</template>
