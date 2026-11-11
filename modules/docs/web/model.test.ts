import { describe, expect, it, vi } from 'vitest';
import { buildTree, lockedBy, moveArgs, searchPages, toProjectArgs, type PageRow } from './model';
import { createSaver } from './save';

const S = 's1';
const pg = (id: string, rank: string, parentId: string | null = null, o: Partial<PageRow> = {}) =>
  ({
    id,
    spaceId: S,
    parentId,
    rank,
    title: id,
    icon: null,
    text: '',
    archivedAt: null,
    ...o,
  }) as PageRow;

describe('docs web: дерево', () => {
  const pages = [
    pg('b', 'a1'),
    pg('a', 'a0'),
    pg('a2', 'a1', 'a'),
    pg('a1', 'a0', 'a'),
    pg('old', 'a2', null, { archivedAt: '2026-01-01T00:00:00.000Z' }),
    pg('kid-of-old', 'a5', 'old'),
  ];

  it('строится по rank, дети после родителя, архивные скрыты вместе с поддеревом', () => {
    const rows = buildTree(pages, S).map((n) => [n.page.id, n.depth]);
    expect(rows).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
      ['kid-of-old', 0], // the parent is archived — the page does not disappear
    ]);
  });

  it('свёрнутые узлы не раскрывают детей', () => {
    expect(buildTree(pages, S, new Set()).map((n) => n.page.id)).toEqual(['a', 'b', 'kid-of-old']);
  });

  it('move: before/after/into дают rank между соседями, цикл — null', () => {
    const before = moveArgs(pages, 'b', 'a2', 'before')!;
    expect(before).toMatchObject({ id: 'b', parentId: 'a' });
    expect(before.rank > 'a0' && before.rank < 'a1').toBe(true);
    const after = moveArgs(pages, 'b', 'a', 'after')!;
    expect(after.parentId).toBeNull();
    expect(after.rank > 'a0').toBe(true);
    const into = moveArgs(pages, 'b', 'a', 'into')!;
    expect(into).toMatchObject({ parentId: 'a' });
    expect(into.rank > 'a1').toBe(true);
    expect(moveArgs(pages, 'a', 'a1', 'into')).toBeNull();
    expect(moveArgs(pages, 'a', 'a', 'before')).toBeNull();
  });

  it('PLNRAPP-5 в проект: в корень после корневых страниц проекта, архивные и чужие не считаются', () => {
    const ps = [
      ...pages,
      pg('p1', 'a3', null, { projectId: 'P' }),
      pg('p0', 'a9', 'p1', { projectId: 'P' }),
      pg('pOld', 'b0', null, { projectId: 'P', archivedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const r = toProjectArgs(ps, 'a1', 'P');
    expect(r).toMatchObject({ id: 'a1', parentId: null, projectId: 'P' });
    expect(r.rank > 'a3' && r.rank < 'b0').toBe(true);
    // to the space: after its roots a, b (old is archived)
    const s = toProjectArgs(ps, 'p1', null);
    expect(s.rank > 'a1').toBe(true);
  });
});

describe('docs web: поиск', () => {
  const pages = [
    pg('1', 'a0', null, { title: 'Ёлка', text: 'новогодняя' }),
    pg('2', 'a1', null, { title: 'План', text: 'про ёлку и подарки' }),
    pg('3', 'a2', null, { title: 'Архив', text: 'ёлка', archivedAt: '2026-01-01T00:00:00.000Z' }),
  ];
  it('по title и text, ё=е, регистр не важен, название выше текста, архив скрыт', () => {
    expect(searchPages(pages, 'ЕЛК', 10).map((p) => p.id)).toEqual(['1', '2']);
    expect(searchPages(pages, 'подарки план', 10).map((p) => p.id)).toEqual(['2']);
    expect(searchPages(pages, '  ', 10)).toEqual([]);
    expect(searchPages(pages, 'елк', 1)).toHaveLength(1);
  });
});

describe('docs web: блокировка и сохранение', () => {
  const lock = { id: 'p', userId: 'other', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  it('lockedBy: чужая действующая — владелец; своя и истёкшая — null', () => {
    expect(lockedBy(lock, 'me')).toBe('other');
    expect(lockedBy(lock, 'other')).toBeNull();
    expect(lockedBy(lock, 'me', Date.now() + 120_000)).toBeNull();
    expect(lockedBy(undefined, 'me')).toBeNull();
  });

  it('saver: правки склеиваются в один патч через 800 мс; flush отправляет сразу', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const s = createSaver<{ title?: string; body?: number }>(send);
    s.push({ title: 'a' });
    vi.advanceTimersByTime(500);
    s.push({ body: 1 });
    vi.advanceTimersByTime(799);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ title: 'a', body: 1 });
    s.push({ body: 2 });
    s.flush();
    s.flush();
    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
