<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Button, Dialog } from '../ui';
import { toast } from '../ui/toast';
import { db, useQuery } from '../sync';
import StatusPicker from './fields/StatusPicker.vue';
import { defaultStatus, moveTarget, moveTask } from './move';

// PLNRAPP-519: moving a task to the project picked in the menu — the status there and whether subtasks go too
const { t } = useI18n();
const m = computed(() => moveTarget.value!);
const statuses = useQuery(() =>
  db.table<Row<'statuses'>>('statuses').where('projectId').equals(m.value.projectId).toArray(),
);
const current = useQuery(() => db.table<Row<'statuses'>>('statuses').get(m.value.task.statusId));
const subtasks = useQuery(() =>
  db.table<Row<'tasks'>>('tasks').where('parentId').equals(m.value.task.id).count(),
);
const statusId = ref<string>();
const withSubtasks = ref(true);
// the offered status — once the statuses are read; the user's choice is not overwritten
watch(
  [statuses, current],
  ([list]) => {
    if (!statusId.value && list?.length) statusId.value = defaultStatus(current.value, list)?.id;
  },
  { immediate: true },
);
const busy = ref(false);
const close = () => (moveTarget.value = null);
async function move() {
  if (!statusId.value) return;
  busy.value = true;
  try {
    await moveTask(m.value.task.id, {
      projectId: m.value.projectId,
      statusId: statusId.value,
      withSubtasks: withSubtasks.value,
    });
    toast(t('moveTask.done', { key: m.value.task.key, to: m.value.label }), 3000);
    close();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="true"
    size="sm"
    :title="t('moveTask.title', { key: m.task.key })"
    :description="t('moveTask.to', { to: m.label })"
    @update:open="(o: boolean) => o || close()"
  >
    <div class="flex items-center gap-2 text-sm" data-testid="move-status">
      <span class="text-fg-muted">{{ t('moveTask.status') }}</span>
      <StatusPicker v-model="statusId" :space-id="m.spaceId" :project-id="m.projectId" />
    </div>
    <label v-if="subtasks" class="flex min-h-9 items-center gap-2 text-sm">
      <input v-model="withSubtasks" type="checkbox" data-testid="move-subtasks" />
      {{ t('moveTask.subtasks', { n: subtasks }) }}
    </label>
    <template #footer>
      <Button @click="close">{{ t('ui.cancel') }}</Button>
      <Button
        variant="primary"
        :disabled="!statusId || busy"
        data-testid="move-confirm"
        @click="move"
        >{{ t('moveTask.action') }}</Button
      >
    </template>
  </Dialog>
</template>
