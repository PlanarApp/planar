/// <reference types="vite/client" />
import { ref, watch, type Component } from 'vue';
import { router } from '../router';
import { useBreakpoint } from '../ui';

export type TaskOpenMode = 'modal' | 'side' | 'page';
const KEY = 'planar.taskOpen';
const read = (): TaskOpenMode => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'side' || v === 'page') return v;
  } catch {
    /* storage unavailable */
  }
  return 'modal';
};
/** How to open a task on desktop (as in Plane/ClickUp): window, side panel, page; a device setting. */
export const taskOpenMode = ref<TaskOpenMode>(read());
watch(taskOpenMode, (v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage unavailable */
  }
});

const GROUP_ROUTES = ['project', 'space', 'workspace'];

export function openTask(key: string): void {
  const r = router.currentRoute.value;
  // window/side panel — on any group screen (TaskModal exists in Tasks and in other tabs)
  if (
    GROUP_ROUTES.includes(String(r.name)) &&
    (useBreakpoint().isMobile.value || taskOpenMode.value !== 'page')
  ) {
    // mobile: fullscreen dialog over the view (TaskModal), so the view keeps scroll/groups/filters
    void router.push({ query: { ...r.query, task: key } });
  } else {
    void router.push(`/t/${encodeURIComponent(key)}`);
  }
}

export function closeTask(): void {
  const query = { ...router.currentRoute.value.query };
  delete query.task;
  void router.push({ query });
}

/** Task panel (WB-6): no file — undefined, the panel does not open. */
export const taskPanelLoader = Object.values(import.meta.glob('../task/TaskPanel.vue'))[0] as
  (() => Promise<{ default: Component }>) | undefined;

/** Built-in views (WB-4, WB-5): replaced in tests. */
export const viewLoaders = (): Record<string, () => Promise<unknown>> =>
  import.meta.glob('../views/*/View.vue');
