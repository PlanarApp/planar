import type { Editor } from '@tiptap/core';

// '/' — block menu: one list for documents, the task description and comments (PLNRAPP-91)
export interface SlashItem {
  id: string;
  title: { ru: string; en: string };
  run(editor: Pick<Editor, 'chain'>, api: { pickImage(): void }): void;
}

const c = (e: Pick<Editor, 'chain'>) => e.chain().focus();

export const slashItems: SlashItem[] = [
  {
    id: 'h1',
    title: { ru: 'Заголовок 1', en: 'Heading 1' },
    run: (e) => void c(e).toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: { ru: 'Заголовок 2', en: 'Heading 2' },
    run: (e) => void c(e).toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: { ru: 'Заголовок 3', en: 'Heading 3' },
    run: (e) => void c(e).toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    title: { ru: 'Список', en: 'Bulleted list' },
    run: (e) => void c(e).toggleBulletList().run(),
  },
  {
    id: 'todo',
    title: { ru: 'Чек-лист', en: 'To-do list' },
    run: (e) => void c(e).toggleTaskList().run(),
  },
  {
    id: 'code',
    title: { ru: 'Код', en: 'Code block' },
    run: (e) => void c(e).toggleCodeBlock().run(),
  },
  {
    id: 'table',
    title: { ru: 'Таблица', en: 'Table' },
    run: (e) => void c(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: 'image', title: { ru: 'Изображение', en: 'Image' }, run: (_e, api) => api.pickImage() },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** By id and both name languages; without images — no 'image'. */
export const filterSlash = (q: string, image = true): SlashItem[] => {
  const n = norm(q.trim());
  return slashItems.filter(
    (i) =>
      (image || i.id !== 'image') &&
      [i.id, i.title.ru, i.title.en].some((s) => norm(s).includes(n)),
  );
};
