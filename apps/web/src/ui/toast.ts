import { shallowRef } from 'vue';

export interface ToastItem {
  id: number;
  text: string;
}

/** Короткие сообщения об ошибках: клик, который упал, не должен выглядеть как «ничего не произошло». */
export const toasts = shallowRef<ToastItem[]>([]);
let seq = 0;

export function toast(text: string, ms = 6000): void {
  // одинаковое сообщение подряд не множим (повторные клики по сломанной кнопке)
  if (toasts.value.at(-1)?.text === text) return;
  const id = ++seq;
  toasts.value = [...toasts.value.slice(-2), { id, text }];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), ms);
}

export const dismiss = (id: number): void => {
  toasts.value = toasts.value.filter((x) => x.id !== id);
};
