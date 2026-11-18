// PLNRAPP-519: the "Move to project" submenu — spaces → projects I can change, in the sidebar order
import { describe, expect, it, vi } from 'vitest';
import type { Row } from '@planar/shared';
import { moveMenu, moveSpaces } from '../moveTargets';
import { defaultStatus } from '../move';

const ME = 'me';
const space = (id: string, rank: string) => ({ id, name: id.toUpperCase(), rank }) as Row<'spaces'>;
const project = (id: string, spaceId: string, rank: string, o: Partial<Row<'projects'>> = {}) =>
  ({
    id,
    name: id.toUpperCase(),
    spaceId,
    rank,
    archivedAt: null,
    membersMode: 'inherit',
    ...o,
  }) as Row<'projects'>;
const sm = (spaceId: string, role: string) =>
  ({ id: spaceId + ME, spaceId, userId: ME, role }) as Row<'spaceMembers'>;
const pm = (projectId: string, role: string) =>
  ({ id: projectId + ME, projectId, userId: ME, role }) as Row<'projectMembers'>;

const data = {
  me: { id: ME, role: 'member' },
  rootId: 'root',
  spaces: [
    space('b', 'a2'),
    space('a', 'a1'),
    space('g', 'a3'),
    space('root', 'a9'),
    space('n', 'a4'),
  ],
  projects: [
    project('a2', 'a', 'a2'),
    project('a1', 'a', 'a1'),
    project('ax', 'a', 'a0', { archivedAt: '2026-01-01' }),
    project('ac', 'a', 'a3', { membersMode: 'custom' }),
    project('ad', 'a', 'a4', { membersMode: 'custom' }),
    project('ag', 'a', 'a5', { membersMode: 'custom' }),
    project('b1', 'b', 'a1'),
    project('g1', 'g', 'a1'),
    project('r1', 'root', 'a1'),
    project('n1', 'n', 'a1'),
  ],
  spaceMembers: [sm('a', 'member'), sm('b', 'admin'), sm('g', 'guest'), sm('root', 'member')],
  projectMembers: [pm('ad', 'member'), pm('ag', 'guest'), { ...pm('b1', 'x'), userId: 'other' }],
};

describe('PLNRAPP-519 цели переноса', () => {
  it('только доступные для изменений; корневое пространство первым, дальше по rank; проекты по rank', () => {
    const r = moveSpaces(data);
    expect(r.map((s) => s.id)).toEqual(['root', 'a', 'b']);
    expect(r.find((s) => s.id === 'a')!.projects.map((p) => p.id)).toEqual(['a1', 'a2', 'ad']);
    expect(r.every((s) => s.writable)).toBe(true);
  });

  it('администратор экземпляра видит все пространства и живые проекты', () => {
    const r = moveSpaces({ ...data, me: { id: ME, role: 'admin' } });
    expect(r.map((s) => s.id)).toEqual(['root', 'a', 'b', 'g', 'n']);
    expect(r.find((s) => s.id === 'a')!.projects).toHaveLength(5);
  });

  it('меню: пространство → проекты, текущее отмечено, выбор текущего ничего не делает', () => {
    const pick = vi.fn();
    const { items, count } = moveMenu(moveSpaces(data), { spaceId: 'a', projectId: 'a1' }, pick);
    expect(count).toBe(5);
    expect(items.map((s) => [s.id, !!s.checked])).toEqual([
      ['root', false],
      ['a', true],
      ['b', false],
    ]);
    const a = items[1]!.children!;
    expect(a.map((p) => [p.label, !!p.checked])).toEqual([
      ['A1', true],
      ['A2', false],
      ['AD', false],
    ]);
    a[0]!.onSelect!();
    expect(pick).not.toHaveBeenCalled();
    a[1]!.onSelect!();
    expect(pick).toHaveBeenCalledWith('a', 'a2');
  });

  it('документ: «Без проекта» первым в пространстве, где можно писать', () => {
    const pick = vi.fn();
    const spaces = [{ id: 's', name: 'S', writable: true, projects: [] }];
    const { items, count } = moveMenu(
      spaces,
      { spaceId: 's', projectId: 'p' },
      pick,
      'Без проекта',
    );
    expect(count).toBe(1);
    expect(items[0]!.children!.map((p) => p.label)).toEqual(['Без проекта']);
    items[0]!.children![0]!.onSelect!();
    expect(pick).toHaveBeenCalledWith('s', null);
  });

  it('статус по умолчанию: то же имя, иначе та же категория, иначе первый', () => {
    const st = (id: string, name: string, category: string, rank: string) =>
      ({ id, name, category, rank }) as Row<'statuses'>;
    const list = [
      st('2', 'Готово', 'done', 'a2'),
      st('1', 'Новая', 'backlog', 'a1'),
      st('3', 'В работе', 'in_progress', 'a3'),
    ];
    expect(defaultStatus({ name: 'готово', category: 'done' }, list)?.id).toBe('2');
    expect(defaultStatus({ name: 'Делаю', category: 'in_progress' }, list)?.id).toBe('3');
    expect(defaultStatus({ name: 'X', category: 'cancelled' }, list)?.id).toBe('1');
  });
});
