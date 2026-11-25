<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CalendarDays } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { Button, Dialog } from '../ui';
import BulkMerge from './BulkMerge.vue';
import {
  BulkAssigneePicker,
  PriorityPicker,
  TaskDatesPicker,
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
// the picker's own values: the time fields open once a date is chosen, as in the task form
const dates = ref({
  start: null as string | null,
  due: null as string | null,
  startTime: null as string | null,
  dueTime: null as string | null,
  dueRemindMin: null as number | null,
});
const setDates = (patch: Parameters<typeof updateTask>[1], local: Partial<typeof dates.value>) => {
  Object.assign(dates.value, local);
  return each((x) => updateTask(x.id, patch));
};
watch(
  () => sel.selected.value,
  () =>
    (dates.value = { start: null, due: null, startTime: null, dueTime: null, dueRemindMin: null }),
);
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
    <!-- the same dates picker as in the task form; the key resets it when the selection changes -->
    <TaskDatesPicker
      :key="chosen.map((x) => x.id).join()"
      :task-ids="chosen.map((x) => x.id)"
      :start="dates.start"
      :due="dates.due"
      :start-time="dates.startTime"
      :due-time="dates.dueTime"
      :due-remind-min="dates.dueRemindMin"
      @update:start="(v: string | null) => setDates({ startDate: v }, { start: v })"
      @update:due="(v: string | null) => setDates({ dueDate: v }, { due: v })"
      @update:start-time="(v: string | null) => setDates({ startTime: v }, { startTime: v })"
      @update:due-time="(v: string | null) => setDates({ dueTime: v }, { dueTime: v })"
      @update:due-remind-min="
        (v: number | null) => setDates({ dueRemindMin: v }, { dueRemindMin: v })
      "
    >
      <template #value>
        <CalendarDays :size="14" aria-hidden="true" />
        <span>{{ t('tasks.dueDate') }}</span>
      </template>
    </TaskDatesPicker>
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
