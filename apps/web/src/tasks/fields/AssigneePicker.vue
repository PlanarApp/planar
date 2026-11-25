<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { UserPicker } from '../../pickers';
import { avatarSrc } from '../../pickers/avatar';
import { Avatar } from '../../ui';
import { useMembers } from '../queries';

// task assignees: the common user picker over the space members (PLNRAPP-827);
// on the button — «avatar name» per person, not all the avatars and then all the names
const props = defineProps<{ spaceId: string; compact?: boolean }>();
const model = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const members = useMembers(() => props.spaceId);
const chosen = computed(() =>
  model.value.flatMap((id) => members.value?.find((u) => u.id === id) ?? []),
);
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
    <template v-else-if="!compact && chosen.length" #value>
      <span class="flex min-w-0 items-center gap-3 overflow-hidden" data-testid="assignee-names">
        <span
          v-for="u in chosen"
          :key="u.id"
          class="inline-flex min-w-0 shrink-0 items-center gap-1.5 last:shrink"
        >
          <Avatar :name="u.name" :src="avatarSrc(u)" size="xs" />
          <span class="truncate">{{ u.name }}</span>
        </span>
      </span>
    </template>
  </UserPicker>
</template>
