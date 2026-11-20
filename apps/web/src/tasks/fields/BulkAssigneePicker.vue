<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Avatar } from '../../ui';
import { nextTri, triDiff, triStates, type Tri } from '../../views/selection';
import { useMembers } from '../queries';
import OptionPicker from './OptionPicker.vue';

/**
 * Assignees of several tasks at once (PLNRAPP-498): each member is on all (✓), some (–) or none of the tasks.
 * A click cycles some → all → none → some (back to "some" = leave as is), otherwise all ↔ none; on close
 * only the changed rows are applied: `add` — to every task, `remove` — from every task.
 */
const props = defineProps<{ spaceId: string; lists: readonly (readonly string[])[] }>();
const emit = defineEmits<{ apply: [diff: { add: string[]; remove: string[] }] }>();
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
const open = ref(false);
// state at opening and the edited one; while closed the picker shows the tasks as they are
const initial = ref<Map<string, Tri> | null>(null);
const edited = ref(new Map<string, Tri>());
const shown = computed(() => (initial.value ? edited.value : triStates(props.lists)));
const ids = (s: Tri) => [...shown.value].filter(([, v]) => v === s).map(([id]) => id);

function start() {
  initial.value = triStates(props.lists);
  edited.value = new Map(initial.value);
}
function finish() {
  if (!initial.value) return;
  const diff = triDiff(initial.value, edited.value);
  initial.value = null;
  if (diff.add.length || diff.remove.length) emit('apply', diff);
}
watch(open, (o) => (o ? start() : finish()));

function pick(id: string) {
  if (!initial.value) start();
  const m = new Map(edited.value);
  m.set(id, nextTri(initial.value!.get(id) ?? 'none', m.get(id) ?? 'none'));
  edited.value = m;
}
</script>

<template>
  <OptionPicker
    v-model:open="open"
    :options="options"
    :selected="ids('all')"
    :partial="ids('some')"
    multiple
    :title="t('tasks.assignee')"
    :empty="t('tasks.noAssignee')"
    @pick="pick"
  />
</template>
