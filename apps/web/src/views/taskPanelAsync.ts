import { defineAsyncComponent, type Component } from 'vue';

// PLNRAPP-834: while the task form chunk loads — its skeleton; no task/ in the build — no skeleton (as with taskPanelLoader)
const skeleton = Object.values(
  import.meta.glob<Component>('../task/TaskSkeleton.vue', { eager: true, import: 'default' }),
)[0];

/** Async task panel with the form skeleton while loading; no loader — undefined. */
export const asyncTaskPanel = (loader: (() => Promise<{ default: Component }>) | undefined) =>
  loader && defineAsyncComponent({ loader, loadingComponent: skeleton, delay: 0 });
