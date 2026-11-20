import { describe, expect, it } from 'vitest';
import { TITLE_MAX, plainDoc, selectionDraft } from '../selectionDraft';

describe('PLNRAPP-684 selectionDraft: выделение → имя и описание задачи', () => {
  it('короткое однострочное — имя без описания', () => {
    expect(selectionDraft('  купить   хлеб ')).toEqual({ title: 'купить хлеб', description: null });
  });
  it('многострочное — имя из первой непустой строки, полный текст в описании', () => {
    expect(selectionDraft('\n  \nкупить хлеб\n\nи молоко  \n')).toEqual({
      title: 'купить хлеб',
      description: 'купить хлеб\n\nи молоко',
    });
  });
  it('одна строка с переводом в конце — не многострочное', () => {
    expect(selectionDraft('купить хлеб\n')).toEqual({ title: 'купить хлеб', description: null });
  });
  it('длинное — обрезка по границе слова с «…», ≤ 120 символов, полный текст в описании', () => {
    const text = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ');
    const d = selectionDraft(text);
    expect(d.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(d.title.endsWith('…')).toBe(true);
    const head = d.title.slice(0, -1);
    expect(text.startsWith(head + ' ')).toBe(true);
    expect(d.description).toBe(text);
  });
  it('ровно 120 символов — без обрезки', () => {
    const text = 'а'.repeat(TITLE_MAX);
    expect(selectionDraft(text)).toEqual({ title: text, description: null });
  });
  it('одно слово длиннее предела — жёсткая обрезка', () => {
    const d = selectionDraft('б'.repeat(300));
    expect(d.title).toBe('б'.repeat(TITLE_MAX - 1) + '…');
    expect(d.description).toBe('б'.repeat(300));
  });
  it('граница слова ровно на пределе', () => {
    const text = 'в'.repeat(TITLE_MAX - 1) + ' хвост';
    expect(selectionDraft(text).title).toBe('в'.repeat(TITLE_MAX - 1) + '…');
  });
  it('plainDoc: строка — абзац, пустая — пустой абзац', () => {
    expect(plainDoc('а\n\nб')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'а' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'б' }] },
      ],
    });
  });
});
