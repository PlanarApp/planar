<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useBreakpoint } from '../ui';
import { closeTask, taskPanelLoader } from '.';
import { taskOpenMode } from './open';

// задача из ?task — окно поверх вида или боковая панель, как в ClickUp; без ловушки фокуса: пикеры открываются в порталах
const route = useRoute();
const { isMobile } = useBreakpoint();
const TaskPanel = taskPanelLoader && defineAsyncComponent(taskPanelLoader);
const taskKey = computed(() => (typeof route.query.task === 'string' ? route.query.task : ''));
const panelOpen = computed(() => !!TaskPanel && !!taskKey.value && !isMobile.value);
const side = computed(() => taskOpenMode.value === 'side');

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && panelOpen.value) closeTask();
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- боковая панель — правая часть сплита в AppShell (под верхней панелью), здесь только окно -->
  <div
    v-if="panelOpen && !side"
    class="fixed inset-0 z-40 flex items-center justify-center bg-overlay p-4 md:p-8"
    data-testid="task-modal"
    @mousedown.self="closeTask"
  >
    <div
      role="dialog"
      aria-modal="true"
      class="flex h-full max-h-[56rem] w-full max-w-7xl overflow-hidden rounded-xl border border-border bg-surface shadow-dialog"
    >
      <component :is="TaskPanel" :task-key="taskKey" mode="panel" @close="closeTask" />
    </div>
  </div>
</template>
