import { getSchema } from '@tiptap/core';
import { DOMParser as PmParser } from '@tiptap/pm/model';
import { Window, type Document, type Element, type Node } from 'happy-dom';
import { serverExtensions } from '@planar/editor';

/** A mention of a Plane user: our user (mention node) or a name (plain `@name`); null — unknown. */
export type MentionOf = (planeUserId: string) => { id: string; label: string } | string | null;

const parser = PmParser.fromSchema(getSchema(serverExtensions()));
// inert parsing: DOMParser documents run no scripts and load nothing
let dom: { parseFromString(html: string, type: 'text/html'): Document } | undefined;
const parse = (html: string): Document => {
  dom ??= new new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  }).DOMParser() as never;
  return dom.parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
};

/**
 * HTML of the Plane editor (TipTap, like ours) → our document by the server schema; null — empty.
 * Plane's own tags: mention-component → mention, image-component / attachment-component → a text
 * placeholder (files are PLNRAPP-875), horizontalRule div → hr. Unknown tags keep their text.
 */
export function htmlToDoc(html: string, mentionOf: MentionOf): Record<string, unknown> | null {
  const doc = parse(html);
  const swap = (sel: string, make: (el: Element) => Node) =>
    doc.querySelectorAll(sel).forEach((el) => el.replaceWith(make(el)));
  const p = (text: string) => {
    const el = doc.createElement('p');
    el.textContent = text;
    return el;
  };
  swap('mention-component', (el) => {
    const m = mentionOf(el.getAttribute('entity_identifier') ?? '');
    if (!m || typeof m === 'string') return doc.createTextNode(`@${m ?? '?'}`);
    const span = doc.createElement('span');
    span.setAttribute('data-type', 'mention');
    span.setAttribute('data-id', m.id);
    span.setAttribute('data-label', m.label);
    return span;
  });
  swap('image-component', () => p('[изображение]'));
  swap('attachment-component', (el) => p(`[вложение: ${el.getAttribute('name') ?? ''}]`));
  swap('[data-type="horizontalRule"]', () => doc.createElement('hr'));
  // happy-dom nodes are DOM-compatible for the ProseMirror parser
  const json = parser.parse(doc.body as never).toJSON() as {
    content?: { type: string; content?: unknown[] }[];
  };
  const c = json.content ?? [];
  if (!c.length || (c.length === 1 && c[0]!.type === 'paragraph' && !c[0]!.content?.length))
    return null;
  return json;
}
