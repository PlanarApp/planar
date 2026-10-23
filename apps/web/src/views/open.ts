/// <reference types="vite/client" />
import type { Component } from 'vue';
import { router } from '../router';
import { useBreakpoint } from '../ui';

export function openTask(key: string): void {
  const r = router.currentRoute.value;
  if (r.name === 'project' && !useBreakpoint().isMobile.value) {
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
