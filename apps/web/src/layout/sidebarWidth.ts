import { ref } from 'vue';

const KEY = 'planar.sidebarWidth';
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 240; // = former w-60

export const clampWidth = (w: number): number =>
  Number.isFinite(w)
    ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
    : SIDEBAR_DEFAULT;

const read = (): number => {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return clampWidth(Number(v));
  } catch {
    /* storage unavailable */
  }
  return SIDEBAR_DEFAULT;
};

/** Sidebar width in px (desktop): a personal client setting in localStorage. */
export const sidebarWidth = ref(read());

export type SidebarMode = 'full' | 'rail' | 'hidden';
export const RAIL_WIDTH = 56;
const MODE_KEY = 'planar.sidebarMode';

const readMode = (): SidebarMode => {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'rail' || v === 'hidden') return v;
  } catch {
    /* storage unavailable */
  }
  return 'full';
};

/** Desktop sidebar mode: full, a narrow rail of project keys, or hidden; remembered like the width. */
export const sidebarMode = ref<SidebarMode>(readMode());

export function setSidebarMode(m: SidebarMode) {
  sidebarMode.value = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage unavailable */
  }
}

export function setSidebarWidth(w: number) {
  sidebarWidth.value = clampWidth(w);
  try {
    localStorage.setItem(KEY, String(sidebarWidth.value));
  } catch {
    /* storage unavailable */
  }
}
