import { getCurrentScope, onScopeDispose, reactive } from 'vue';

/** Shared overlay state: palette (with initial query) and cheat sheet. */
export const ui = reactive({
  palette: false,
  query: '',
  cheat: false,
  create: false,
  createProject: '',
});

/** Quick task creation dialog; projectId — default project. */
export const quickCreate = (projectId = ''): void => {
  ui.createProject = projectId;
  ui.create = true;
};

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

/** Letters — by physical key (KeyC → 'c'), so it works on any layout; '?' — Shift+Slash. */
const tokenOf = (e: KeyboardEvent) => {
  const m = /^Key([A-Z])$/.exec(e.code ?? '');
  if (m) return m[1].toLowerCase();
  return e.key === '?' || (e.shiftKey && e.code === 'Slash') ? '?' : e.key;
};

function onKey(e: KeyboardEvent) {
  // already handled by a local handler (the List's keys on its focused row)
  if (e.defaultPrevented) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = tokenOf(e);
  // Cmd/Ctrl+K also works in input fields
  const token = mod && key === 'k' ? 'mod+k' : key;
  // composedPath: an input inside a shadow root (emoji picker search) — e.target is only its host
  const target = e.composedPath?.()[0] ?? e.target;
  if (token !== 'mod+k' && (mod || e.altKey || editable(target))) return;
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

/** combo: 'mod+k', '?', 'c', a space-separated sequence — 'g i'. */
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
