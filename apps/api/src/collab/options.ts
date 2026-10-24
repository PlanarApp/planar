export const COLLAB_OPTS = Symbol('COLLAB_OPTS');
/** Debounce сохранения, мс (P3-ydoc: 2 с, не реже раза в 10 с); в тестах — меньше. */
export interface CollabOpts {
  debounceMs: number;
  maxDebounceMs: number;
}
/** COLLAB_DEBOUNCE_MS — только тесты (createApp опций не принимает). */
export const defaultCollabOpts = (): CollabOpts => {
  const d = Number(process.env.COLLAB_DEBOUNCE_MS) || 2000;
  return { debounceMs: d, maxDebounceMs: Math.max(d, 10_000 * (d / 2000)) };
};
