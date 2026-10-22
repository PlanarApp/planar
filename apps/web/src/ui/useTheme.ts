import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'planar.theme';

const read = (): Theme => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* хранилище недоступно */
  }
  return 'system';
};

const theme = ref<Theme>(read());
const systemDark = ref(false);
let inited = false;
let applied = false;

const init = () => {
  if (inited) return;
  inited = true;
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return;
  systemDark.value = mq.matches;
  mq.addEventListener?.('change', (e) => (systemDark.value = e.matches));
};

const apply = () => {
  document.documentElement.classList.toggle('dark', resolvedRef.value === 'dark');
  try {
    localStorage.setItem(KEY, theme.value);
  } catch {
    /* хранилище недоступно */
  }
};

const resolvedRef = computed<'light' | 'dark'>(() =>
  theme.value === 'system' ? (systemDark.value ? 'dark' : 'light') : theme.value,
);

export function useTheme(initial?: Theme): {
  theme: Ref<Theme>;
  resolved: ComputedRef<'light' | 'dark'>;
} {
  init();
  if (!applied) {
    applied = true;
    watch([theme, systemDark], apply, { flush: 'sync', immediate: true });
  }
  if (initial) theme.value = initial;
  return { theme, resolved: resolvedRef };
}
