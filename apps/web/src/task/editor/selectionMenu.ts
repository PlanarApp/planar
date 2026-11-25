import type { Component } from 'vue';
import type { Editor } from '@tiptap/core';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListTodo,
  SquareCode,
  Strikethrough,
} from 'lucide-vue-next';
import { slashItems } from './slash';

// the menu over a selection: inline marks + the block commands of «/» + selection → task (hotfix 2026-11-25)
export interface SelItem {
  id: string;
  icon: Component;
  title: { ru: string; en: string };
  run(editor: Pick<Editor, 'chain'>): void;
}

const c = (e: Pick<Editor, 'chain'>) => e.chain().focus();
const item = (
  id: string,
  icon: Component,
  ru: string,
  en: string,
  run: SelItem['run'],
): SelItem => ({
  id,
  icon,
  title: { ru, en },
  run,
});

export const markItems: SelItem[] = [
  item('bold', Bold, 'Жирный', 'Bold', (e) => void c(e).toggleBold().run()),
  item('italic', Italic, 'Курсив', 'Italic', (e) => void c(e).toggleItalic().run()),
  item(
    'strike',
    Strikethrough,
    'Зачёркнутый',
    'Strikethrough',
    (e) => void c(e).toggleStrike().run(),
  ),
  item('inlineCode', Code, 'Код в строке', 'Inline code', (e) => void c(e).toggleCode().run()),
];

const blockIcons: Record<string, Component> = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  todo: ListTodo,
  code: SquareCode,
};

/** «/» commands that work on a selection (table and image would replace it): the definitions are the slash ones */
export const blockItems: SelItem[] = slashItems
  .filter((i) => i.id in blockIcons)
  .map((i) => ({
    id: i.id,
    icon: blockIcons[i.id],
    title: i.title,
    run: (e) => i.run(e, { pickImage: () => {} }),
  }));

/** link of the selection: asks for the address; an empty answer removes the link, cancel does nothing */
export const linkItem = (ask: () => string | null): SelItem =>
  item('link', Link, 'Ссылка', 'Link', (e) => {
    const href = ask()?.trim();
    if (href === undefined) return;
    if (href) void c(e).setLink({ href }).run();
    else void c(e).unsetLink().run();
  });

/** Menu groups by editor context: a read-only editor (own comment) gets only «to task» */
export function selectionGroups(o: { editable: boolean; toTask: boolean }): string[][] {
  const groups = o.editable
    ? [[...markItems.map((i) => i.id), 'link'], blockItems.map((i) => i.id)]
    : [];
  if (o.toTask) groups.push(['task', 'subtask']);
  return groups;
}
