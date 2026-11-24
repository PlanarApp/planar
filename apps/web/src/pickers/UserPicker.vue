<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Avatar } from '../ui';
import OptionPicker from '../tasks/fields/OptionPicker.vue';
import { avatarSrc } from './avatar';

/**
 * The one user picker (PLNRAPP-827): search over the given people, an avatar (picture or initials) in the
 * list and on the button. `none` — an extra first item «nobody», its pick emits null.
 */
export interface PickUser {
  id: string;
  name: string;
  avatarFile?: string | null;
  /** ready picture URL (instead of avatarFile) */
  avatar?: string | null;
}
const NONE = '__none';
const props = defineProps<{
  users: readonly PickUser[];
  selected: readonly string[];
  multiple?: boolean;
  /** button label for screen readers and the search field */
  title?: string;
  /** button text when nobody is selected */
  empty?: string;
  /** label of the «nobody» item; without it there is no such item */
  none?: string;
  compact?: boolean;
  /** bordered button like a form field (settings), otherwise a flat one (task fields) */
  field?: boolean;
  /** ids on some of the selected tasks — the "partially" mark (bulk edit) */
  partial?: readonly string[];
}>();
const emit = defineEmits<{ pick: [id: string | null] }>();
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
const options = computed(() => [
  ...(props.none ? [{ id: NONE, label: props.none }] : []),
  ...props.users.map((u) => ({
    id: u.id,
    label: u.name,
    icon: Avatar,
    iconProps: { name: u.name, src: u.avatar ?? avatarSrc(u), size: 'xs' },
  })),
]);
</script>

<template>
  <OptionPicker
    v-model:open="open"
    :options="options"
    :selected="[...selected]"
    :partial="partial ? [...partial] : undefined"
    :multiple="multiple"
    :title="title ?? t('tasks.assignee')"
    :empty="empty ?? none ?? t('tasks.noAssignee')"
    :compact="compact"
    :field="field"
    testid="user-picker"
    @pick="emit('pick', $event === NONE ? null : $event)"
  >
    <template v-if="$slots.value" #value><slot name="value" /></template>
  </OptionPicker>
</template>
