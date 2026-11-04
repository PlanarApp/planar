/**
 * Mobile keyboards keep the word being typed in IME composition, and Vue's v-model ignores input until
 * compositionend — Enter then submitted the title without its last word. On Enter (capture phase, before
 * component handlers and form submit) the composition is committed into v-model the way compositionend does.
 */
export function commitImeOnEnter(target: Document): () => void {
  const onKeydown = (e: KeyboardEvent) => {
    const el = e.target as (HTMLInputElement & { composing?: boolean }) | null;
    if (e.key !== 'Enter' || !el?.composing) return;
    el.composing = false; // the flag v-model checks; its compositionend handler then has nothing left to do
    el.dispatchEvent(new Event('input'));
  };
  target.addEventListener('keydown', onKeydown, true);
  return () => target.removeEventListener('keydown', onKeydown, true);
}
