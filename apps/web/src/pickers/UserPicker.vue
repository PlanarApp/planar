<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import OptionPicker from '../tasks/fields/OptionPicker.vue';
import { userIcon } from './avatar';

/**
 * The one user picker (PLNRAPP-827): search over the given people, an avatar (picture or initials) in the
 * list and on the button. `none` — an extra first item «nobody», its pick emits null; `create` — an item
 * «create new» after it, its pick emits `create` (import), `creating` shows it as the chosen one.
 */
export interface PickUser {
  id: string;
  name: string;
  avatarFile?: string | null;
  /** ready picture URL (instead of avatarFile) */
  avatar?: string | null;
}
const NONE = '__none';
const CREATE = '__create';
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
  /** label of the «create new» item; without it there is no such item */
  create?: string;
  /** «create new» is the current choice */
  creating?: boolean;
  compact?: boolean;
  /** bordered button like a form field (settings), otherwise a flat one (task fields) */
  field?: boolean;
  /** ids on some of the selected tasks — the "partially" mark (bulk edit) */
  partial?: readonly string[];
}>();
const emit = defineEmits<{ pick: [id: string | null]; create: [] }>();
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
const options = computed(() => [
  ...(props.none ? [{ id: NONE, label: props.none }] : []),
  ...(props.create ? [{ id: CREATE, label: props.create }] : []),
  ...props.users.map((u) => ({ id: u.id, label: u.name, ...userIcon(u) })),
]);
function onPick(id: string) {
  if (id === CREATE) emit('create');
  else emit('pick', id === NONE ? null : id);
}
</script>

<template>
  <OptionPicker
    v-model:open="open"
    :options="options"
    :selected="creating && create ? [CREATE] : [...selected]"
    :partial="partial ? [...partial] : undefined"
    :multiple="multiple"
    :title="title ?? t('tasks.assignee')"
    :empty="empty ?? none ?? t('tasks.noAssignee')"
    :compact="compact"
    :field="field"
    testid="user-picker"
    @pick="onPick"
  >
    <template v-if="$slots.value" #value><slot name="value" /></template>
  </OptionPicker>
</template>
