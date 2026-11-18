import { describe, expect, it } from 'vitest';
import { progressOf } from '../progress';

// PLNRAPP-333: «closed/total» of the subtasks and the checklist on a row / card
describe('progressOf', () => {
  const statuses = [
    { id: 'todo', category: 'todo' as const },
    { id: 'done', category: 'done' as const },
    { id: 'no', category: 'cancelled' as const },
    undefined,
  ];
  it('subtasks: closed — done and cancelled; archived are not counted', () => {
    const p = progressOf(
      [
        { statusId: 'todo', archivedAt: null },
        { statusId: 'done', archivedAt: null },
        { statusId: 'no', archivedAt: null },
        { statusId: 'done', archivedAt: '2026-01-01' },
        { statusId: 'gone', archivedAt: null },
      ],
      statuses,
      [],
    );
    expect(p.subtasks).toEqual({ done: 2, total: 4 });
    expect(p.checklist).toEqual({ done: 0, total: 0 });
  });
  it('checklist: done items of all', () => {
    expect(progressOf([], [], [{ done: true }, { done: false }, { done: true }]).checklist).toEqual(
      { done: 2, total: 3 },
    );
  });
});
