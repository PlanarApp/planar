import { SAVE_DEBOUNCE_MS } from './model';

/** Копит изменения полей и отправляет одним патчем через delay после последнего. */
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
