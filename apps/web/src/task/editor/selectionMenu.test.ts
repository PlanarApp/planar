import { describe, expect, it } from 'vitest';
import { blockItems, selectionGroups } from './selectionMenu';
import { slashItems } from './slash';

describe('selectionMenu', () => {
  it('в редактируемом редакторе — форматирование и блоки, в задаче ещё «в задачу»', () => {
    expect(selectionGroups({ editable: true, toTask: false })).toHaveLength(2);
    expect(selectionGroups({ editable: true, toTask: true }).at(-1)).toEqual(['task', 'subtask']);
  });
  it('только чтение: одна «в задачу» (свой комментарий), без задачи — пусто', () => {
    expect(selectionGroups({ editable: false, toTask: true })).toEqual([['task', 'subtask']]);
    expect(selectionGroups({ editable: false, toTask: false })).toEqual([]);
  });
  it('блоки берутся из слэш-команд, без таблицы и картинки', () => {
    const ids = blockItems.map((i) => i.id);
    expect(ids).toContain('h1');
    expect(ids).not.toContain('table');
    expect(ids).not.toContain('image');
    expect(ids.every((id) => slashItems.some((s) => s.id === id))).toBe(true);
  });
});
