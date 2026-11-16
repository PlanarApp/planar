import { ref } from 'vue';

const KEY = 'planar.taskAsideWidth';
export const ASIDE_MIN = 280;
export const ASIDE_DEFAULT = 384; // = former w-96
const ASIDE_MAX_SHARE = 0.6;
const MAIN_MIN = 360;

/** Upper bound for the comments panel in a card `total` px wide: 60 % and the main part keeps its minimum. */
export const asideMax = (total: number): number =>
  Math.max(ASIDE_MIN, Math.min(total * ASIDE_MAX_SHARE, total - MAIN_MIN));

/** `total` is the card width; unknown (0) — only the lower bound applies. */
export const clampAside = (w: number, total = 0): number =>
  Number.isFinite(w)
    ? Math.round(Math.max(ASIDE_MIN, total > 0 ? Math.min(w, asideMax(total)) : w))
    : ASIDE_DEFAULT;

const read = (): number => {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return clampAside(Number(v));
  } catch {
    /* storage unavailable */
  }
  return ASIDE_DEFAULT;
};

/** Comments panel width in px (desktop): a personal client setting in localStorage. */
export const asideWidth = ref(read());

export function setAsideWidth(w: number, total = 0) {
  asideWidth.value = clampAside(w, total);
  try {
    localStorage.setItem(KEY, String(asideWidth.value));
  } catch {
    /* storage unavailable */
  }
}
