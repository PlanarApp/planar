import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { serverExtensions } from './index.js';

/** Markdown ↔ TipTap doc by the editor schema (the same as collab's); no DOM — for the server. */
const md = new MarkdownManager({ extensions: serverExtensions() });

export function markdownToDoc(text: string): { type: 'doc'; content: JSONContent[] } {
  const d = md.parse(text);
  return { type: 'doc', content: d.content ?? [] };
}

/** Mentions → @label: the extension renders its own [@ id=…] syntax, unreadable for people and agents. */
const plainMentions = (n: JSONContent): JSONContent =>
  n.type === 'mention'
    ? { type: 'text', text: `@${String(n.attrs?.label ?? '')}` }
    : n.content
      ? { ...n, content: n.content.map(plainMentions) }
      : n;

export const docToMarkdown = (doc: JSONContent): string => md.serialize(plainMentions(doc));
