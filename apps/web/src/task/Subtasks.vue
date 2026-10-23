<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { StatusIcon, createTask, type TaskView } from '../tasks';
import { Input } from '../ui';
import { useSubtasks } from './queries';

const props = defineProps<{ task: TaskView; statuses: Row<'statuses'>[] }>();
const emit = defineEmits<{ open: [key: string] }>();
const { t } = useI18n();
const subtasks = useSubtasks(props.task.id);
const title = ref('');

async function add() {
  const s = title.value.trim();
  const status = props.statuses[0];
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
    <h3 class="mb-1 text-sm font-medium text-fg-muted">{{ t('task.subtasks') }}</h3>
    <ul>
      <li v-for="s in subtasks" :key="s.id">
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-muted md:min-h-8"
          @click="emit('open', s.key)"
        >
          <StatusIcon
            v-if="statuses.find((x) => x.id === s.statusId)"
            :status="statuses.find((x) => x.id === s.statusId)!"
          />
          <span class="text-xs text-fg-subtle">{{ s.key }}</span>
          <span class="flex-1 truncate">{{ s.title }}</span>
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
