<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { StatusIcon, StatusPicker, updateTask } from '../tasks';
import { useMoveSpaces } from '../tasks/moveTargets';

// PLNRAPP-629: the task status in the «Comments for me» card header — the subtasks' picker (StatusPicker
// compact); without write access to the task's project (a guest) — an inactive icon, the menu does not open
const props = defineProps<{
  task: Pick<Row<'tasks'>, 'id' | 'spaceId' | 'projectId' | 'statusId'>;
  status: Row<'statuses'> | null;
}>();
const { t } = useI18n();
// writable projects — the same rule as «Move to project» (admin or member, PJ-11)
const spaces = useMoveSpaces();
const writable = computed(() =>
  spaces.value.some((s) => s.projects.some((p) => p.id === props.task.projectId)),
);
const hint = computed(() => props.status?.name ?? t('tasks.status'));
</script>

<template>
  <span
    v-if="status"
    class="inline-flex shrink-0"
    :title="hint"
    data-testid="work-status"
    @click.stop
  >
    <StatusPicker
      v-if="writable"
      compact
      :space-id="task.spaceId"
      :project-id="task.projectId"
      :model-value="task.statusId"
      @update:model-value="updateTask(task.id, { statusId: $event })"
    />
    <span
      v-else
      role="img"
      :aria-label="hint"
      aria-disabled="true"
      class="inline-flex h-7 cursor-not-allowed items-center px-1.5 opacity-60"
    >
      <StatusIcon :status="status" />
    </span>
  </span>
</template>
