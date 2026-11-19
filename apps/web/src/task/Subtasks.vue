<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { createTask, useMembers, type TaskView } from '../tasks';
import { Input } from '../ui';
import { useSubtasks } from './queries';
import ListRow from '../views/list/Row.vue';
import type { TaskField } from '../views/options';

const props = defineProps<{ task: TaskView; statuses: Row<'statuses'>[] }>();
const emit = defineEmits<{ open: [key: string] }>();
const { t } = useI18n();
const subtasks = useSubtasks(props.task.id);
const members = useMembers(() => props.task.spaceId);
// the List row with a compact set of fields: status icon, key, title, assignee (PLNRAPP-540)
const fields: TaskField[] = ['status', 'assignee'];
const editing = ref<string | null>(null);
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
    <div
      v-if="subtasks?.length"
      role="grid"
      :aria-label="t('task.subtasks')"
      class="mb-1 overflow-hidden rounded-lg border border-border [&>*:last-child]:border-b-0"
      data-testid="subtasks-list"
    >
      <ListRow
        v-for="(s, i) in subtasks"
        :key="s.id"
        class="min-h-16 cursor-pointer md:min-h-8"
        :task="s"
        :space-id="task.spaceId"
        :index="i + 1"
        :selected="false"
        :focused="false"
        :editing="editing === s.id"
        :fields="fields"
        :blocked="false"
        :members="members ?? []"
        :labels="[]"
        show-key
        compact
        @click="emit('open', s.key)"
        @edit="editing = s.id"
        @done="editing = null"
      />
    </div>
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
