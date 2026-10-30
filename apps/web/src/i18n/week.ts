import { computed, ref } from 'vue';
import { i18n } from './index';

const KEY = 'planar.weekStart';
type Pref = 'auto' | '0' | '1';

const read = (): Pref => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '0' || v === '1') return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
};
const pref = ref<Pref>(read());

/** First day of week: 0 — Sunday, 1 — Monday; auto — by locale (en → 0, ru → 1). */
export function useWeekStart() {
  return computed<0 | 1>(() =>
    pref.value === 'auto'
      ? i18n.global.locale.value === 'en'
        ? 0
        : 1
      : pref.value === '0'
        ? 0
        : 1,
  );
}

export function setWeekStart(v: 'auto' | 0 | 1): void {
  pref.value = String(v) as Pref;
  try {
    if (v === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(v));
  } catch {
    /* storage unavailable */
  }
}
