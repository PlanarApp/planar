export const COLLAB_OPTS = Symbol('COLLAB_OPTS');
/** Save debounce, ms (P3-ydoc: 2 s, at most once per 10 s); smaller in tests. */
export interface CollabOpts {
  debounceMs: number;
  maxDebounceMs: number;
}
/** COLLAB_DEBOUNCE_MS — tests only (createApp does not accept options). */
export const defaultCollabOpts = (): CollabOpts => {
  const d = Number(process.env.COLLAB_DEBOUNCE_MS) || 2000;
  return { debounceMs: d, maxDebounceMs: Math.max(d, 10_000 * (d / 2000)) };
};
