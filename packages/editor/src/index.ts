import Image from '@tiptap/extension-image';
import Mention, { type MentionOptions } from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import type { AnyExtension, Extensions } from '@tiptap/core';

/** Схема ProseMirror редактора: одна для web и api (P3-ydoc), без DOM и Vue. */
export function editorExtensions(
  o: {
    image?: boolean;
    suggestion?: MentionOptions['suggestion'];
    /** Свой Mention (узел `mention` с attrs.kind); по умолчанию — обычный. */
    mention?: AnyExtension;
    /** Yjs: встроенная история выключена (undo — Collaboration). */
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

/** Для сервера: схема со всеми узлами (картинка нужна, лишние узлы схему не ломают). */
export const serverExtensions = (): Extensions => editorExtensions({ image: true });

/** Палитра курсоров: один источник для всех клиентов (P3-collab «Awareness»). */
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

/** Цвет участника: hash(userId) mod N, детерминирован. */
export function cursorColor(userId: string): string {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length]!;
}
