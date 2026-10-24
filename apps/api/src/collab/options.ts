export const COLLAB_OPTS = Symbol('COLLAB_OPTS');
/** Debounce сохранения, мс (P3-ydoc: 2 с, не реже раза в 10 с); в тестах — меньше. */
export interface CollabOpts {
  debounceMs: number;
  maxDebounceMs: number;
}
export const defaultCollabOpts: CollabOpts = { debounceMs: 2000, maxDebounceMs: 10_000 };
