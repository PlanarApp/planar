import { shallowRef } from 'vue';

export interface ToastItem {
  id: number;
  text: string;
}

/** Short error messages: a click that failed must not look like "nothing happened". */
export const toasts = shallowRef<ToastItem[]>([]);
let seq = 0;

export function toast(text: string, ms = 6000): void {
  // don't multiply an identical message in a row (repeated clicks on a broken button)
  if (toasts.value.at(-1)?.text === text) return;
  const id = ++seq;
  toasts.value = [...toasts.value.slice(-2), { id, text }];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), ms);
}

export const dismiss = (id: number): void => {
  toasts.value = toasts.value.filter((x) => x.id !== id);
};
