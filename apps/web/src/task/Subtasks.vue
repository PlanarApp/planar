<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronRight, UserPlus } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { AssigneePicker, StatusPicker, createTask, useMembers, type TaskView } from '../tasks';
import { AvatarStack, Input } from '../ui';
import { avatarSrc } from '../pickers';
import { useSubtasks } from './queries';
import TaskListView from '../views/list/TaskListView.vue';
import { useProjectListSettings } from '../views/list/projectSettings';
import { provideSelection } from '../views/selection';

const props = defineProps<{ task: TaskView; statuses: Row<'statuses'>[] }>();
const emit = defineEmits<{ open: [key: string] }>();
const { t } = useI18n();
const subtasks = useSubtasks(props.task.id);
const members = useMembers(() => props.task.spaceId);
// PLNRAPP-865: the rows — the List's task list with the "View" settings of the parent's project List
// (fields, their order, density, grouping, sorting), live; the subtasks are its top-level rows, all of
// them (not "only mine")
const settings = useProjectListSettings(() => props.task.projectId, {
  showSubtasks: true,
  me: null,
});
const status = (id: string) => props.statuses.find((x) => x.id === id);
// closed: categories done and cancelled
const isClosed = (x: TaskView) =>
  ['done', 'cancelled'].includes(status(x.statusId)?.category ?? '');
const closed = computed(() => (subtasks.value ?? []).filter(isClosed));
const done = computed(() => closed.value.length);
// the "Closed N" accordion: collapsed on every opening of the card, not saved (PLNRAPP-542)
const showClosed = ref(false);
const title = ref('');
const shown = computed(() => subtasks.value?.filter((x) => showClosed.value || !isClosed(x)));
const source = computed(() => ({ tasks: shown.value }));
// own selection (PLNRAPP-541): not the view's under the side panel
provideSelection();

// PLNRAPP-828: the new subtask's status and assignees — chosen by the buttons right of the input;
// the status by default — the first one of the project (PJ-1); the choice stays for the next subtasks
const projectStatuses = computed(() =>
  props.statuses.filter((x) => x.projectId === props.task.projectId),
);
const newStatus = ref<string>();
watch(
  projectStatuses,
  (all) => {
    if (!all.some((x) => x.id === newStatus.value)) newStatus.value = all[0]?.id;
  },
  { immediate: true },
);
const newAssignees = ref<string[]>([]);
const newPeople = computed(() =>
  newAssignees.value
    .map((id) => members.value?.find((m) => m.id === id))
    .filter((m) => !!m)
    .map((m) => ({ name: m.name, src: avatarSrc(m) })),
);
async function add() {
  const s = title.value.trim();
  const statusId = newStatus.value;
  if (!s || !statusId) return;
  title.value = '';
  await createTask({
    projectId: props.task.projectId,
    statusId,
    title: s,
    parentId: props.task.id,
    ...(newAssignees.value.length && { assigneeIds: [...newAssignees.value] }),
  });
}
</script>

<template>
  <section :aria-label="t('task.subtasks')">
    <!-- the title is the tab (PLNRAPP-100) -->
    <div v-if="subtasks?.length" class="mb-1 flex items-center gap-3">
      <span class="text-xs text-fg-muted" data-testid="subtasks-progress">{{
        t('task.subtasksDone', { done, n: subtasks.length })
      }}</span>
      <div class="h-1.5 w-24 overflow-hidden rounded-full bg-bg-muted">
        <div
          class="h-full rounded-full bg-success"
          :style="{ width: `${(done / subtasks.length) * 100}%` }"
        />
      </div>
    </div>
    <!-- PLNRAPP-865: the List's rows, context menu, selection, bulk bar and dragging;
         PLNRAPP-866: mobile — edge to edge over the padding of the card column (TaskDetail: px-4, @2xl:px-8), as the mobile List: the same
         row width, so the same name wrapping, row height, paddings and checkbox place -->
    <div
      v-if="shown?.length"
      class="mb-1 max-md:-mx-4 max-md:@2xl:-mx-8"
      data-testid="subtasks-list"
    >
      <TaskListView
        :source="source"
        :settings="settings"
        :project-id="task.projectId"
        :root-id="task.id"
        :open="(key) => emit('open', key)"
        :quick-create="false"
        :window-keys="false"
      />
    </div>
    <button
      v-if="closed.length"
      type="button"
      class="mb-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-fg-muted hover:text-fg"
      :aria-expanded="showClosed"
      data-testid="subtasks-closed"
      @click="showClosed = !showClosed"
    >
      <ChevronRight
        :size="12"
        :class="['shrink-0 transition-transform', showClosed && 'rotate-90']"
      />{{ t('task.subtasksClosed', { n: closed.length }) }}
    </button>
    <form class="flex items-center gap-1" data-testid="subtask-add" @submit.prevent="add">
      <Input
        v-model="title"
        class="min-w-0 flex-1"
        :label="t('task.addSubtask')"
        hide-label
        :placeholder="t('task.addSubtask')"
      />
      <!-- PLNRAPP-828: the new subtask's status and assignees (the common user picker) -->
      <StatusPicker
        v-model="newStatus"
        :space-id="task.spaceId"
        :project-id="task.projectId"
        data-testid="subtask-new-status"
      />
      <AssigneePicker
        v-model="newAssignees"
        :space-id="task.spaceId"
        data-testid="subtask-new-assignees"
      >
        <template #value>
          <AvatarStack v-if="newPeople.length" :people="newPeople" />
          <UserPlus v-else :size="16" class="text-fg-muted" />
        </template>
      </AssigneePicker>
    </form>
  </section>
</template>
