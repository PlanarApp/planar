import { onBeforeUnmount, onMounted } from 'vue';
import { router } from '../router';
import { tokenOf } from '../command/hotkeys';
import { sideTaskOpen } from './open';

const MOVE = ['j', 'k', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];

/**
 * View keys (Table, Board) when focus is lost on the page or is in the side panel — as in the List
 * (PLNRAPP-79, -133): from the page focus comes back to the view; in the panel — only j/k, arrows only
 * from a button left focused after a picker. sync — the task shown in the panel becomes the focused one.
 */
export function useLostFocusKeys(
  root: () => HTMLElement | undefined,
  run: (key: string) => boolean,
  sync: (taskKey: string) => void,
): void {
  function onWindowKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || root()?.contains(t)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
    const inSheet = sideTaskOpen() && !!t.closest('[data-testid=task-side]');
    const onTab = t.tagName === 'A' && !!t.closest('nav');
    if (t !== document.body && !inSheet && !onTab) return;
    const k = tokenOf(e);
    const move = MOVE.includes(k);
    if (onTab && !move) return;
    if (inSheet && k !== 'j' && k !== 'k' && !(move && t.tagName === 'BUTTON')) return;
    if (sideTaskOpen()) {
      const shown = router.currentRoute.value.query.task;
      if (typeof shown === 'string') sync(shown);
    }
    if (!run(k)) return;
    e.preventDefault();
    if (!inSheet) root()?.focus({ preventScroll: true });
  }
  onMounted(() => window.addEventListener('keydown', onWindowKey));
  onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey));
}
