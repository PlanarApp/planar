import Image from '@tiptap/extension-image';
import Mention, { type MentionOptions } from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import type { AnyExtension, Extensions } from '@tiptap/core';

/** ProseMirror schema of the editor: one for web and api (P3-ydoc), without DOM and Vue. */
export function editorExtensions(
  o: {
    image?: boolean;
    suggestion?: MentionOptions['suggestion'];
    /** Own Mention (the `mention` node with attrs.kind); by default — the regular one. */
    mention?: AnyExtension;
    /** Yjs: the built-in history is off (undo — Collaboration). */
    collab?: boolean;
  } = {},
): Extensions {
  return [
    StarterKit.configure(o.collab ? { undoRedo: false } : {}),
    o.mention ??
      Mention.extend({
        addAttributes() {
          return { ...this.parent?.(), kind: { default: null } };
        },
      }).configure({
        HTMLAttributes: { class: 'mention' },
        ...(o.suggestion ? { suggestion: o.suggestion } : {}),
      }),
    Table,
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(o.image ? [Image] : []),
  ];
}

/** For the server: schema with all nodes (the image is needed; extra nodes do not break the schema). */
export const serverExtensions = (): Extensions => editorExtensions({ image: true });

/** Cursor palette: one source for all clients (P3-collab «Awareness»). */
export const CURSOR_COLORS = [
  '#e5484d',
  '#f76b15',
  '#ffb224',
  '#30a46c',
  '#12a594',
  '#0091ff',
  '#6e56cf',
  '#d6409f',
];

/** Member colour: hash(userId) mod N, deterministic. */
export function cursorColor(userId: string): string {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length]!;
}
