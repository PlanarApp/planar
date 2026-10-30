import type { Editor } from '@tiptap/vue-3';
import { norm } from './model';
import { label, type TextKey } from './text';

export interface SlashItem {
  id: string;
  title: TextKey;
  run(editor: Pick<Editor, 'chain'>, api: { pickImage(): void }): void;
}

const c = (e: Pick<Editor, 'chain'>) => e.chain().focus();

export const slashItems: SlashItem[] = [
  { id: 'h1', title: 'h1', run: (e) => void c(e).toggleHeading({ level: 1 }).run() },
  { id: 'h2', title: 'h2', run: (e) => void c(e).toggleHeading({ level: 2 }).run() },
  { id: 'h3', title: 'h3', run: (e) => void c(e).toggleHeading({ level: 3 }).run() },
  { id: 'bullet', title: 'bullet', run: (e) => void c(e).toggleBulletList().run() },
  { id: 'todo', title: 'todo', run: (e) => void c(e).toggleTaskList().run() },
  { id: 'code', title: 'code', run: (e) => void c(e).toggleCodeBlock().run() },
  {
    id: 'table',
    title: 'table',
    run: (e) => void c(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: 'image', title: 'image', run: (_e, api) => api.pickImage() },
];

/** By id and both name languages. */
export const filterSlash = (q: string): SlashItem[] => {
  const n = norm(q.trim());
  return slashItems.filter((i) =>
    [i.id, label(i.title).ru, label(i.title).en].some((s) => norm(s).includes(n)),
  );
};
