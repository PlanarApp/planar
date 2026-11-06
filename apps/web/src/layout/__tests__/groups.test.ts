import { beforeEach, describe, expect, it } from 'vitest';
import { groupUrl, lastTab, lastView, nodeLanding } from '../groups';

describe('таб узла', () => {
  beforeEach(() => localStorage.clear());
  it('Задачи — явный сегмент list, остальные табы — свой', () => {
    expect(groupUrl('project', 'p1')).toBe('/p/p1/list');
    expect(groupUrl('space', 's1', 'docs')).toBe('/s/s1/docs');
    expect(groupUrl('workspace', '', 'tasks')).toBe('/w/list');
  });
  it('PLNRAPP-111 Задачи — последний выбранный вид', () => {
    lastView.set('board');
    expect(groupUrl('space', 's1')).toBe('/s/s1/board');
    expect(groupUrl('project', 'p1', 'docs')).toBe('/p/p1/docs');
  });
  it('по умолчанию — «Моя работа», запомненный таб и раздел — после записи', () => {
    expect(lastTab.get()).toEqual({ seg: 'work' });
    lastTab.set({ seg: 'board' });
    expect(nodeLanding('/p/p2', lastTab.get())).toEqual({ path: '/p/p2/board', query: {} });
    lastTab.set({ seg: 'work', w: 'comments' });
    expect(nodeLanding('/w/', lastTab.get())).toEqual({
      path: '/w/work',
      query: { w: 'comments' },
    });
  });
  it('битое значение в хранилище — «Моя работа»', () => {
    localStorage.setItem('planar.groupTab', '{"seg":42}');
    expect(lastTab.get()).toEqual({ seg: 'work' });
  });
});
