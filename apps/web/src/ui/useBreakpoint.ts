import { ref, type Ref } from 'vue';

// one listener for the app
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

/** Tests only: reset the cache after replacing matchMedia. */
export function resetBreakpoint(): void {
  isMobile = undefined;
}
