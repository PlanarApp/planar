<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SquareCheck } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import StatusIcon from '../tasks/fields/StatusIcon.vue';
import PickList from './PickList.vue';

/** The one task picker (PLNRAPP-827): key, title, status and the parents' path; the search is the caller's. */
export interface PickTask {
  id: string;
  /** PLN-12 */
  key: string;
  title: string;
  path?: string;
  status?: Row<'statuses'>;
}
const props = defineProps<{
  tasks: readonly PickTask[];
  label?: string;
  hint?: string;
  autofocus?: boolean;
  inputTestid?: string;
  optionTestid?: string;
}>();
const emit = defineEmits<{ pick: [task: PickTask]; key: [e: KeyboardEvent] }>();
const q = defineModel<string>('query', { default: '' });
const { t } = useI18n();
const list = ref<InstanceType<typeof PickList> | null>(null);
const rows = computed(() =>
  props.tasks.map((x) => ({
    id: x.id,
    title: x.title,
    prefix: x.key,
    path: x.path,
    ...(x.status ? { icon: StatusIcon, iconProps: { status: x.status } } : {}),
  })),
);
defineExpose({ focus: () => list.value?.focus() });
</script>

<template>
  <PickList
    ref="list"
    v-model:query="q"
    :rows="rows"
    :label="label ?? t('pickers.taskSearch')"
    :none="t('pickers.noTasks')"
    :hint="hint"
    :icon="SquareCheck"
    :autofocus="autofocus"
    :input-testid="inputTestid"
    :option-testid="optionTestid"
    @pick="
      (id) =>
        emit(
          'pick',
          tasks.find((x) => x.id === id)!,
        )
    "
    @key="emit('key', $event)"
  />
</template>
