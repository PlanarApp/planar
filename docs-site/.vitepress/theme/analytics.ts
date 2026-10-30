// Loads GA4 and Yandex Metrika only after the visitor accepts (consent stored in localStorage).
// Ids: VITE_GA_ID, VITE_YM_ID (build env). Empty id: that counter is not loaded.
const KEY = 'planar-docs-consent'; // 'granted' | 'denied'

export function getConsent(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setConsent(v: 'granted' | 'denied'): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage blocked: choice lasts for this page only */
  }
  if (v === 'granted') loadCounters();
}

let loaded = false;
function loadCounters(): void {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  const ga = import.meta.env.VITE_GA_ID as string | undefined;
  const ym = import.meta.env.VITE_YM_ID as string | undefined;
  if (ga) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}`;
    document.head.appendChild(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.dataLayer = w.dataLayer || [];
    // gtag.js needs the real `arguments` object, an array does not work
    w.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer.push(arguments);
    };
    w.gtag('js', new Date());
    w.gtag('config', ga);
  }
  if (ym && /^\d+$/.test(ym)) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://mc.yandex.ru/metrika/tag.js';
    s.onload = () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ym?.(Number(ym), 'init', {
        clickmap: true,
        trackLinks: true,
        accurateTrackBounce: true,
      });
    document.head.appendChild(s);
  }
}

export function initConsent(): void {
  if (getConsent() === 'granted') loadCounters();
}
