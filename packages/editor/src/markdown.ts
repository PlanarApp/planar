import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { serverExtensions } from './index.js';

/** Markdown ↔ TipTap doc by the editor schema (the same as collab's); no DOM — for the server. */
const md = new MarkdownManager({ extensions: serverExtensions() });

/**
 * A single newline inside a paragraph (a soft break) → hardBreak: AI answers and agents write line by line, and
 * a `\n` inside a text node collapses into a space in the chat and the description (PLNRAPP-334). Code keeps `\n`.
 */
const hardBreaks = (n: JSONContent): JSONContent => {
  if (n.type === 'codeBlock' || !n.content) return n;
  const content = n.content.flatMap((c): JSONContent[] => {
    if (c.type !== 'text' || !c.text?.includes('\n')) return [hardBreaks(c)];
    const out: JSONContent[] = [];
    c.text.split('\n').forEach((part, i) => {
      if (i) out.push({ type: 'hardBreak' });
      if (part) out.push({ ...c, text: part });
    });
    return out;
  });
  // a break at the edge of a paragraph is an empty line, not a line break
  while (content[0]?.type === 'hardBreak') content.shift();
  while (content.at(-1)?.type === 'hardBreak') content.pop();
  return { ...n, content };
};

export function markdownToDoc(text: string): { type: 'doc'; content: JSONContent[] } {
  const d = hardBreaks(md.parse(text));
  return { type: 'doc', content: d.content ?? [] };
}

/**
 * Mentions → @label: the extension renders its own [@ id=…] syntax, unreadable for people and agents.
 * hardBreak → a plain `\n` (not `  \n`): markdownToDoc reads it back as hardBreak, so md → doc → md keeps the text (PLNRAPP-334).
 */
const plainInline = (n: JSONContent): JSONContent =>
  n.type === 'hardBreak'
    ? { type: 'text', text: '\n' }
    : n.type === 'mention'
      ? { type: 'text', text: `@${String(n.attrs?.label ?? '')}` }
      : n.content
        ? { ...n, content: n.content.map(plainInline) }
        : n;

export const docToMarkdown = (doc: JSONContent): string => md.serialize(plainInline(doc));
