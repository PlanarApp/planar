import { describe, expect, it } from 'vitest';
import { isIncomplete, type Rule } from '../../../../../../modules/automations/shared/index';
import {
  ImportError,
  exportRules,
  importRules,
  parseExport,
  type Dict,
} from '../../../../../../modules/automations/web/transfer';

const dict = (over: Partial<Dict> = {}): Dict => ({
  statuses: [],
  labels: [],
  fields: [],
  users: [],
  aiActions: [],
  projects: [],
  subscriptions: [],
  ...over,
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const source = dict({
  statuses: [
    { id: id(1), name: 'В работе', category: 'in_progress' },
    { id: id(2), name: 'Готово', category: 'done' },
  ],
  labels: [{ id: id(3), name: 'bug' }],
  users: [{ id: id(4), login: 'ann', email: 'ann@x.io' }],
  fields: [{ id: id(5), name: 'Оценка', type: 'number' }],
});
const rule = {
  id: id(9),
  name: 'R',
  description: null,
  enabled: true,
  trigger: { type: 'task.status_changed', to: [id(2)] },
  conditions: { op: 'and', rules: [{ field: 'label', operator: 'in', value: [id(3)] }] },
  actions: [
    { type: 'set_status', statusId: id(1) },
    { type: 'assign', userId: id(4) },
    { type: 'set_field', field: `field:${id(5)}`, value: 3 },
  ],
} as unknown as Rule;

const target = dict({
  statuses: [
    { id: id(11), name: 'В работе', category: 'in_progress' },
    { id: id(12), name: 'Готово', category: 'done' },
  ],
  labels: [{ id: id(13), name: 'bug' }],
  users: [{ id: id(14), login: 'ann', email: null }],
  fields: [{ id: id(15), name: 'Оценка', type: 'number' }],
});
const roundtrip = (d: Dict) =>
  importRules(parseExport(JSON.stringify(exportRules([rule], source))), d);

describe('automations transfer', () => {
  it('переносит правило в проект с другими id', () => {
    const [r] = roundtrip(target);
    expect(r!.missing).toEqual([]);
    expect(r!.enabled).toBe(true);
    expect(r!.trigger).toEqual({ type: 'task.status_changed', to: [id(12)] });
    expect(r!.actions[0]).toEqual({ type: 'set_status', statusId: id(11) });
    expect(r!.actions[1]).toEqual({ type: 'assign', userId: id(14) });
    expect(r!.actions[2]).toMatchObject({ field: `field:${id(15)}` });
    expect(r!.conditions.rules[0]!.value).toEqual([id(13)]);
  });

  it('не найденное — пусто, правило выключено', () => {
    const [r] = roundtrip(dict({ statuses: target.statuses }));
    expect(r!.enabled).toBe(false);
    expect(r!.missing).toEqual(['user «ann»', 'field «Оценка»', 'label «bug»']);
    expect(r!.actions[1]).toEqual({ type: 'assign', userId: '' });
    expect(r!.actions[2]).toMatchObject({ field: 'field:' });
    expect(isIncomplete(r!)).toBe(true);
  });

  it('статус ищется по имени, если категория другая', () => {
    const [r] = roundtrip({
      ...target,
      statuses: [{ id: id(12), name: 'Готово', category: 'cancelled' }],
    });
    expect(r!.trigger).toEqual({ type: 'task.status_changed', to: [id(12)] });
  });

  it('неизвестная версия, чужой формат и не JSON — ошибка', () => {
    expect(() => parseExport('{"format":"planar.automations","version":99,"rules":[]}')).toThrow(
      ImportError,
    );
    expect(() => parseExport('{"format":"x","version":1,"rules":[]}')).toThrow(ImportError);
    expect(() => parseExport('nope')).toThrow(ImportError);
  });
});
