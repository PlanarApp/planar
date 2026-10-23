<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';
import { useTask } from '../tasks';
import { Button } from '../ui';
import TaskDetail from './TaskDetail.vue';

const props = defineProps<{ taskKey: string; mode: 'panel' | 'page' }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const task = useTask(() => props.taskKey);
</script>

<template>
  <TaskDetail v-if="task" :key="task.id" :task="task" :mode="mode" @close="emit('close')" />
  <div v-else-if="task === null" class="flex items-center gap-2 p-4" role="alert">
    <span class="flex-1">{{ t('task.notFound') }}</span>
    <Button variant="ghost" :icon="X" :aria-label="t('task.close')" @click="emit('close')" />
  </div>
</template>
