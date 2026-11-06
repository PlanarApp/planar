import { ref } from 'vue';

const KEY = 'planar.taskPanelWidth';
export const TASK_PANEL_MIN = 400;
export const TASK_PANEL_MAX = 1400;
export const TASK_PANEL_DEFAULT = 896; // = former 56rem

export const clampPanelWidth = (w: number): number =>
  Number.isFinite(w)
    ? Math.min(TASK_PANEL_MAX, Math.max(TASK_PANEL_MIN, Math.round(w)))
    : TASK_PANEL_DEFAULT;

const read = (): number => {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return clampPanelWidth(Number(v));
  } catch {
    /* storage unavailable */
  }
  return TASK_PANEL_DEFAULT;
};

/** Task side panel width in px (desktop): a personal client setting in localStorage. */
export const taskPanelWidth = ref(read());

/** Open side panels (TaskModal instances in side mode): the app shell moves its content aside by the width. */
export const sidePanels = ref(0);

const PIN_KEY = 'planar.taskPanelPinned';
const readPin = (): boolean => {
  try {
    return localStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
};
/** Pinned side panel moves the screen aside, unpinned — covers it (PLNRAPP-65); a device setting. */
export const taskPanelPinned = ref(readPin());

export function setTaskPanelPinned(v: boolean) {
  taskPanelPinned.value = v;
  try {
    localStorage.setItem(PIN_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export function setTaskPanelWidth(w: number) {
  taskPanelWidth.value = clampPanelWidth(w);
  try {
    localStorage.setItem(KEY, String(taskPanelWidth.value));
  } catch {
    /* storage unavailable */
  }
}
