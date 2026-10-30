<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Dialog } from '../ui';
import {
  AssigneePicker,
  DueDatePicker,
  PriorityPicker,
  StatusPicker,
  deleteTask,
  setAssignees,
  updateTask,
  type TaskView,
} from '../tasks';
import { useSelection } from './selection';

/** Bulk action bar for the selected tasks of the view (one mutation per task). */
const props = defineProps<{ spaceId: string; tasks: readonly TaskView[] | undefined }>();
const { t } = useI18n();
const sel = useSelection();
const chosen = computed(() => (props.tasks ?? []).filter((x) => sel.selected.value.has(x.id)));
const each = (f: (x: TaskView) => Promise<unknown>) => Promise.all(chosen.value.map(f));
const confirmDelete = ref(false);
async function removeSelected() {
  confirmDelete.value = false;
  await each((x) => deleteTask(x.id));
  sel.clear();
}
</script>

<template>
  <div
    v-if="chosen.length"
    role="toolbar"
    :aria-label="t('list.selected', { n: chosen.length })"
    class="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-3 py-2 text-sm"
    data-testid="bulk-bar"
  >
    <span>{{ t('list.selected', { n: chosen.length }) }}</span>
    <StatusPicker
      :space-id="spaceId"
      @update:model-value="each((x) => updateTask(x.id, { statusId: $event }))"
    />
    <AssigneePicker
      :space-id="spaceId"
      @update:model-value="
        each((x) => setAssignees(x.id, [...new Set([...x.assigneeIds, ...$event])]))
      "
    />
    <PriorityPicker @update:model-value="each((x) => updateTask(x.id, { priority: $event }))" />
    <DueDatePicker @update:model-value="each((x) => updateTask(x.id, { dueDate: $event }))" />
    <Button variant="danger" size="sm" @click="confirmDelete = true">{{ t('list.delete') }}</Button>
    <Button size="sm" variant="ghost" @click="sel.clear()">{{ t('table.clear') }}</Button>
  </div>
  <Dialog
    v-model:open="confirmDelete"
    :title="t('list.deleteTitle')"
    :description="t('list.deleteText', { n: chosen.length })"
  >
    <template #footer>
      <Button @click="confirmDelete = false">{{ t('list.cancel') }}</Button>
      <Button variant="danger" data-testid="confirm-delete" @click="removeSelected">{{
        t('list.delete')
      }}</Button>
    </template>
  </Dialog>
</template>
