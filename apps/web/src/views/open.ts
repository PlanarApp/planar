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
    /* хранилище недоступно */
  }
  return 'modal';
};
/** Как открывать задачу на десктопе (как в Plane/ClickUp): окно, боковая панель, страница; настройка устройства. */
export const taskOpenMode = ref<TaskOpenMode>(read());
watch(taskOpenMode, (v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* хранилище недоступно */
  }
});

export function openTask(key: string): void {
  const r = router.currentRoute.value;
  if (r.name === 'project' && taskOpenMode.value !== 'page' && !useBreakpoint().isMobile.value) {
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

/** Панель задачи (WB-6): нет файла — undefined, панель не открывается. */
export const taskPanelLoader = Object.values(import.meta.glob('../task/TaskPanel.vue'))[0] as
  (() => Promise<{ default: Component }>) | undefined;

/** Встроенные виды (WB-4, WB-5): подменяется в тестах. */
export const viewLoaders = (): Record<string, () => Promise<unknown>> =>
  import.meta.glob('../views/*/View.vue');
