<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { StatusIcon, createTask, type TaskView } from '../tasks';
import { Input } from '../ui';
import { useSubtasks } from './queries';
import { formatDue } from '../views/list/due';

const props = defineProps<{ task: TaskView; statuses: Row<'statuses'>[] }>();
const emit = defineEmits<{ open: [key: string] }>();
const { t, locale } = useI18n();
const subtasks = useSubtasks(props.task.id);
const title = ref('');
const status = (id: string) => props.statuses.find((x) => x.id === id);
// done: categories done and cancelled
const done = computed(
  () =>
    (subtasks.value ?? []).filter((x) =>
      ['done', 'cancelled'].includes(status(x.statusId)?.category ?? ''),
    ).length,
);

async function add() {
  const s = title.value.trim();
  const status = props.statuses.find((x) => x.projectId === props.task.projectId); // PJ-1
  if (!s || !status) return;
  title.value = '';
  await createTask({
    projectId: props.task.projectId,
    statusId: status.id,
    title: s,
    parentId: props.task.id,
  });
}
</script>

<template>
  <section :aria-label="t('task.subtasks')">
    <div class="mb-1 flex items-center gap-3">
      <h3 class="text-sm font-medium text-fg-muted">{{ t('task.subtasks') }}</h3>
      <template v-if="subtasks?.length">
        <span class="text-xs text-fg-muted" data-testid="subtasks-progress">{{
          t('task.subtasksDone', { done, n: subtasks.length })
        }}</span>
        <div class="h-1.5 w-24 overflow-hidden rounded-full bg-bg-muted">
          <div
            class="h-full rounded-full bg-success"
            :style="{ width: `${(done / subtasks.length) * 100}%` }"
          />
        </div>
      </template>
    </div>
    <ul v-if="subtasks?.length" class="mb-1 overflow-hidden rounded-lg border border-border">
      <li v-for="s in subtasks" :key="s.id" class="border-b border-border last:border-b-0">
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-bg-muted md:min-h-9"
          @click="emit('open', s.key)"
        >
          <StatusIcon v-if="status(s.statusId)" :status="status(s.statusId)!" />
          <span class="font-mono text-xs text-fg-subtle">{{ s.key }}</span>
          <span class="flex-1 truncate">{{ s.title }}</span>
          <span v-if="s.dueDate" class="text-xs text-fg-muted">{{
            formatDue(s.dueDate, locale)
          }}</span>
        </button>
      </li>
    </ul>
    <form @submit.prevent="add">
      <Input
        v-model="title"
        :label="t('task.addSubtask')"
        hide-label
        :placeholder="t('task.addSubtask')"
      />
    </form>
  </section>
</template>
