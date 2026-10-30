import { SAVE_DEBOUNCE_MS } from './model';

/** Accumulates field changes and sends them in one patch after a delay following the last. */
export function createSaver<P extends object>(
  send: (patch: P) => unknown,
  delay = SAVE_DEBOUNCE_MS,
) {
  let pending: P | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    if (!pending) return;
    const p = pending;
    pending = null;
    void send(p);
  };
  return {
    push(patch: P) {
      pending = { ...pending, ...patch };
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
  };
}
