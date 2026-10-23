<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { taskPanelLoader } from '../views';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const TaskPanel = taskPanelLoader && defineAsyncComponent(taskPanelLoader);
const taskKey = computed(() => String(route.params.key));
</script>

<template>
  <component
    :is="TaskPanel"
    v-if="TaskPanel"
    :task-key="taskKey"
    mode="page"
    @close="router.back()"
  />
  <div v-else class="p-4 text-fg-muted">{{ t('views.taskUnavailable') }}</div>
</template>
