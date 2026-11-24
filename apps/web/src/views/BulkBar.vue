<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Dialog } from '../ui';
import BulkMerge from './BulkMerge.vue';
import {
  BulkAssigneePicker,
  DueDatePicker,
  PriorityPicker,
  StatusPicker,
  archiveTask,
  deleteTask,
  setAssignees,
  updateTask,
  useProjectAdmin,
  useStatuses,
  type TaskView,
} from '../tasks';
import { applyDiff, useSelection } from './selection';
import { setStatusesByName } from './scope';
import { toast } from '../ui/toast';

/** Bulk action bar for the selected tasks of the view (one mutation per task). */
const props = defineProps<{
  spaceId: string;
  tasks: readonly TaskView[] | undefined;
  /** PLNRAPP-823: ids for the «select all» checkbox when the view has no header row with it */
  selectAll?: readonly string[];
}>();
const { t } = useI18n();
const statuses = useStatuses(() => props.spaceId);
const sel = useSelection();
const chosen = computed(() => (props.tasks ?? []).filter((x) => sel.selected.value.has(x.id)));
const each = (f: (x: TaskView) => Promise<unknown>) => Promise.all(chosen.value.map(f));
// PLNRAPP-498: only the changed assignees; setAssignees sends no mutation to a task left as it was
const assign = ({ add, remove }: { add: string[]; remove: string[] }) =>
  each((x) => setAssignees(x.id, applyDiff(x.assigneeIds, add, remove)));
const projectIds = computed(() => [...new Set(chosen.value.map((x) => x.projectId))]);
// PLNRAPP-637: a status missing from a task's project is not set there — say so instead of silence
async function setStatus(id: string | undefined) {
  const skipped = await setStatusesByName(statuses.value ?? [], chosen.value, id);
  if (skipped) toast(t('list.statusSkipped', { n: skipped }));
}
const confirmDelete = ref(false);
// PLNRAPP-155: archive — any member; delete — an admin of every selected task's project
const admin = useProjectAdmin();
const canDelete = computed(() => chosen.value.every((x) => admin(x.spaceId, x.projectId)));
async function archiveSelected() {
  await each((x) => archiveTask(x.id));
  sel.clear();
}
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
    <input
      v-if="selectAll"
      type="checkbox"
      :checked="sel.state(selectAll) === 'all'"
      :indeterminate="sel.state(selectAll) === 'some'"
      :aria-label="t('list.selectAll')"
      class="size-4"
      data-testid="select-all"
      @click="sel.toggleAll(selectAll)"
    />
    <span>{{ t('list.selected', { n: chosen.length }) }}</span>
    <StatusPicker :space-id="spaceId" :project-ids="projectIds" @update:model-value="setStatus" />
    <BulkAssigneePicker
      :space-id="spaceId"
      :lists="chosen.map((x) => x.assigneeIds)"
      @apply="assign"
    />
    <PriorityPicker @update:model-value="each((x) => updateTask(x.id, { priority: $event }))" />
    <DueDatePicker @update:model-value="each((x) => updateTask(x.id, { dueDate: $event }))" />
    <Button size="sm" data-testid="bulk-archive" @click="archiveSelected">{{
      t('archive.toArchive')
    }}</Button>
    <BulkMerge :tasks="chosen" />
    <Button v-if="canDelete" variant="danger" size="sm" @click="confirmDelete = true">{{
      t('list.delete')
    }}</Button>
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
