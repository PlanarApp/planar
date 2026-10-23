import { getCurrentScope, onScopeDispose, reactive } from 'vue';

/** Общее состояние оверлеев: палитра (с начальным запросом) и шпаргалка. */
export const ui = reactive({ palette: false, query: '', cheat: false });

interface Hotkey {
  combo: string;
  handler: (e: KeyboardEvent) => void;
  label?: string;
}
export const hotkeys: Hotkey[] = reactive([]);

const SEQ_MS = 1000;
let buf: string[] = [];
let last = 0;
let attached = false;

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

function onKey(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  // Cmd/Ctrl+K работает и в полях ввода
  const token = mod && e.key.toLowerCase() === 'k' ? 'mod+k' : e.key;
  if (token !== 'mod+k' && (mod || e.altKey || editable(e.target))) return;
  const now = Date.now();
  if (now - last > SEQ_MS) buf = [];
  last = now;
  const run = (seq: string[]) => {
    const key = seq.join(' ');
    const hit = hotkeys.find((h) => h.combo === key);
    if (hit) {
      e.preventDefault();
      buf = [];
      hit.handler(e);
      return true;
    }
    return hotkeys.some((h) => h.combo.startsWith(key + ' '));
  };
  buf.push(token);
  if (run(buf)) return;
  buf = [token];
  if (!run(buf)) buf = [];
}

/** combo: 'mod+k', '?', 'c', последовательность через пробел — 'g i'. */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts: { label?: string } = {},
): void {
  if (!attached && typeof window !== 'undefined') {
    attached = true;
    window.addEventListener('keydown', onKey);
  }
  const h: Hotkey = { combo, handler, label: opts.label };
  hotkeys.push(h);
  if (getCurrentScope())
    onScopeDispose(() => {
      const i = hotkeys.indexOf(h);
      if (i >= 0) hotkeys.splice(i, 1);
    });
}
