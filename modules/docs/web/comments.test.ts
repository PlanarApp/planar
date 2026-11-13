import { describe, expect, it } from 'vitest';
import { canResolve, threads, type CommentRow } from './comments';

const c = (
  id: string,
  at: string,
  parentId: string | null = null,
  over: Partial<CommentRow> = {},
) =>
  ({
    id,
    spaceId: 's',
    pageId: 'p',
    authorId: 'author',
    parentId,
    body: { type: 'doc' },
    mentions: [],
    assigneeId: null,
    resolvedAt: null,
    resolvedBy: null,
    editedAt: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  }) as CommentRow;

describe('docs comments', () => {
  it('threads: корни по времени, ответы любой глубины под корнем по времени, сироты отброшены', () => {
    const rows = [
      c('r2', '2026-01-02'),
      c('a', '2026-01-03', 'r1'),
      c('r1', '2026-01-01'),
      c('b', '2026-01-04', 'a'),
      c('x', '2026-01-05', 'gone'),
    ];
    expect(threads(rows).map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ['r1', ['a', 'b']],
      ['r2', []],
    ]);
  });

  it('threads: цикл в данных не зацикливает', () => {
    expect(threads([c('a', '1', 'b'), c('b', '2', 'a')])).toEqual([]);
  });

  it('canResolve: только назначенный; исполнитель, автор или admin', () => {
    const assigned = c('a', '1', null, { assigneeId: 'u1' });
    expect(canResolve(c('a', '1'), 'author', true)).toBe(false);
    expect(canResolve(assigned, 'u1', false)).toBe(true);
    expect(canResolve(assigned, 'author', false)).toBe(true);
    expect(canResolve(assigned, 'other', false)).toBe(false);
    expect(canResolve(assigned, 'other', true)).toBe(true);
    expect(canResolve(assigned, undefined, true)).toBe(false);
  });
});
