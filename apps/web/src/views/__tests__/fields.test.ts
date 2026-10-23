import 'fake-indexeddb/auto';
import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { db } from '../../sync';
import { ids, reset, T } from '../../tasks/__tests__/data';
import { matchFilter } from '..';
import { useTaskFilter } from '../saved/useFilter';

const def = (id: string, type: string, options: Record<string, unknown> = {}) => ({
  id,
  type,
  options,
  projectId: ids.project,
  spaceId: ids.space,
  name: id,
  rank: 'a0',
  createdAt: T,
  updatedAt: T,
});
const f1 = uuidv7();
const f2 = uuidv7();
const defs = [def(f1, 'number'), def(f2, 'select', { choices: [{ id: 'c1', label: 'A' }] })];
const ctx = { statuses: [], userId: 'u', today: '2026-10-23', fieldDefs: defs as never };
const task = (fields: Record<string, unknown>) => ({ fields }) as never;
const m = (fields: Record<string, unknown>, rule: Record<string, unknown>) =>
  matchFilter(task(fields), { op: 'and', rules: [rule] } as never, ctx);

beforeEach(reset);

describe('fields-ui: фильтр', () => {
  it('fields-ui: gte/lte по числу', () => {
    expect(m({ [f1]: 5 }, { field: `field:${f1}`, operator: 'gte', value: 6 })).toBe(false);
    expect(m({ [f1]: 5 }, { field: `field:${f1}`, operator: 'lte', value: 5 })).toBe(true);
    expect(m({ [f1]: 0 }, { field: `field:${f1}`, operator: 'lte', value: 0 })).toBe(true);
  });
  it('fields-ui: in по select и isEmpty', () => {
    expect(m({ [f2]: 'c1' }, { field: `field:${f2}`, operator: 'in', value: ['c1'] })).toBe(true);
    expect(m({ [f2]: 'c1' }, { field: `field:${f2}`, operator: 'notIn', value: ['c1'] })).toBe(
      false,
    );
    expect(m({}, { field: `field:${f2}`, operator: 'isEmpty' })).toBe(true);
  });
  it('fields-ui: удалённое поле и отсутствие fieldDefs пропускаются', () => {
    const rule = { field: 'field:gone', operator: 'gte', value: 1 };
    expect(m({}, rule)).toBe(true);
    const r = { op: 'and', rules: [{ field: `field:${f1}`, operator: 'gte', value: 9 }] };
    expect(matchFilter(task({ [f1]: 1 }), r as never, { ...ctx, fieldDefs: undefined })).toBe(true);
  });
  it('fields-ui: useTaskFilter передаёт fieldDefs', async () => {
    await db.table('fieldDefs').bulkPut(defs);
    const scope = effectScope();
    const pred = scope.run(() =>
      useTaskFilter(
        { op: 'and', rules: [{ field: `field:${f1}`, operator: 'gte', value: 9 }] },
        [],
      ),
    )!;
    await vi.waitFor(() => expect(pred.value(task({ [f1]: 1 }) as never)).toBe(false));
    expect(pred.value(task({ [f1]: 10 }) as never)).toBe(true);
    scope.stop();
  });
});
