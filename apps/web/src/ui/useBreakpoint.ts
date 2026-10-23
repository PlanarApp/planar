import { ref, type Ref } from 'vue';

// один слушатель на приложение
let isMobile: Ref<boolean> | undefined;

export function useBreakpoint(): { isMobile: Ref<boolean> } {
  if (!isMobile) {
    const mq = window.matchMedia('(max-width: 767.98px)');
    isMobile = ref(mq.matches);
    const r = isMobile;
    mq.addEventListener?.('change', (e) => (r.value = e.matches));
  }
  return { isMobile };
}

/** Только для тестов: сбросить кэш после подмены matchMedia. */
export function resetBreakpoint(): void {
  isMobile = undefined;
}
