<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { overlayOpen, useBreakpoint } from '../ui';
import { closeTask, taskPanelLoader } from '.';
import { taskOpenMode } from './open';
import {
  TASK_PANEL_MAX,
  TASK_PANEL_MIN,
  setTaskPanelWidth,
  sidePanels,
  taskPanelPinned,
  taskPanelWidth,
} from '../ui/taskPanelWidth';

// task from ?task — a window over the view or a side panel, as in ClickUp; no focus trap: pickers open in portals
const route = useRoute();
const { isMobile } = useBreakpoint();
const TaskPanel = taskPanelLoader && defineAsyncComponent(taskPanelLoader);
const taskKey = computed(() => (typeof route.query.task === 'string' ? route.query.task : ''));
const panelOpen = computed(() => !!TaskPanel && !!taskKey.value);
const side = computed(() => taskOpenMode.value === 'side' && !isMobile.value);
// pinned side panel moves the screen aside (PLANARAPP-53), unpinned covers it — the pin button in the
// panel header (PLNRAPP-65); a counter — several screens draw a TaskModal
const shown = computed(() => panelOpen.value && side.value && taskPanelPinned.value);
// own contribution, not shown: the route may drop ?task in the same tick the screen unmounts this
// TaskModal (switching a tab), then the watcher never runs and shown is already false (PLANARAPP-63)
let counted = false;
const count = (v: boolean) => {
  if (v !== counted) sidePanels.value += v ? 1 : -1;
  counted = v;
};
watch(shown, count, { immediate: true });
onBeforeUnmount(() => count(false));

// handle on the left edge: the panel is glued to the right, so width = window width - pointer x
const onDown = () => {
  const move = (e: PointerEvent) => setTaskPanelWidth(window.innerWidth - e.clientX);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
};
const onHandleKey = (e: KeyboardEvent) => {
  const d = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
  if (d) setTaskPanelWidth(taskPanelWidth.value + d);
};

// Esc closes an open picker first, the task only when nothing is open over it (PLNRAPP-101)
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && panelOpen.value && !overlayOpen(e)) closeTask();
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- боковой лист: ниже верхней панели, экран под ним остаётся рабочим (клик по другой задаче — сменить её) -->
  <div
    v-if="panelOpen && side"
    role="dialog"
    class="fixed bottom-0 right-0 top-11 z-30 flex max-w-full overflow-hidden border-l border-border bg-surface shadow-dialog"
    :style="{ width: taskPanelWidth + 'px' }"
    data-testid="task-side"
  >
    <div
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      data-testid="task-side-resize"
      :aria-valuenow="taskPanelWidth"
      :aria-valuemin="TASK_PANEL_MIN"
      :aria-valuemax="TASK_PANEL_MAX"
      class="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-accent/40 focus-visible:bg-accent/60"
      @pointerdown.prevent="onDown"
      @keydown="onHandleKey"
    />
    <component :is="TaskPanel" :task-key="taskKey" mode="panel" @close="closeTask" />
  </div>
  <div
    v-else-if="panelOpen"
    class="fixed inset-0 z-40 flex items-center justify-center bg-overlay md:p-8"
    data-testid="task-modal"
    @mousedown.self="closeTask"
  >
    <div
      role="dialog"
      aria-modal="true"
      class="flex h-full w-full overflow-hidden bg-surface md:max-h-[56rem] md:max-w-7xl md:rounded-xl md:border md:border-border md:shadow-dialog"
    >
      <component :is="TaskPanel" :task-key="taskKey" mode="panel" @close="closeTask" />
    </div>
  </div>
</template>
