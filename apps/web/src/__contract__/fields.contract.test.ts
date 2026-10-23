// @vitest-environment node
// Контрактный тест features (F-fields, F-filter): экспорты по docs/contracts/features.md.
// Правит только координатор модуля features.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as shared from '@planar/shared';
import * as fields from '../fields/index';
import { matchFilter } from '../views/index';

const doc = readFileSync(
  new URL('../../../../docs/contracts/features.md', import.meta.url),
  'utf8',
);
const part = doc.split(/^## F-fields v\d+\s*$/m)[1]?.split(/^## /m)[0] ?? '';
const names = (head: string) => {
  const t = part.split(/^### /m).find((s) => s.startsWith(head)) ?? '';
  return [...t.matchAll(/^\| `(\w+)` \| ((?:\\\||[^|])+) \|/gm)]
    .filter((r) => !r[2].trim().startsWith('тип'))
    .map((r) => r[1]);
};

describe('F-fields: экспорты', () => {
  it('таблицы разобраны', () => {
    expect(names('Экспорты shared')).toEqual([
      'FIELD_TYPES',
      'fieldOptionsSchema',
      'defaultFieldOptions',
      'fieldValueSchema',
    ]);
    expect(names('Web')).toEqual([
      'useFieldDefs',
      'setTaskField',
      'formatFieldValue',
      'FieldCell',
      'FieldEditor',
    ]);
  });
  it.each(names('Экспорты shared'))('shared %s', (n) => {
    expect(
      (shared as Record<string, unknown>)[n],
      `@planar/shared не экспортирует ${n}`,
    ).toBeDefined();
  });
  it.each(names('Web'))('web %s', (n) => {
    expect(
      (fields as Record<string, unknown>)[n],
      `fields/index.ts не экспортирует ${n}`,
    ).toBeDefined();
  });
});

describe('F-fields: значения', () => {
  const s = shared as unknown as {
    FIELD_TYPES: readonly string[];
    fieldValueSchema(d: { type: string; options: Record<string, unknown> }): {
      safeParse(v: unknown): { success: boolean };
    };
  };
  const ok = (type: string, v: unknown, options: Record<string, unknown> = {}) =>
    s.fieldValueSchema({ type, options }).safeParse(v).success;
  it('7 типов по порядку', () => {
    expect([...s.FIELD_TYPES]).toEqual([
      'text',
      'number',
      'date',
      'select',
      'user',
      'url',
      'money',
    ]);
  });
  it('форматы по таблице', () => {
    expect(ok('text', 'a')).toBe(true);
    expect(ok('text', '')).toBe(false);
    expect(ok('number', 1.5)).toBe(true);
    expect(ok('number', '1')).toBe(false);
    expect(ok('date', '2026-10-23')).toBe(true);
    expect(ok('date', '23.10.2026')).toBe(false);
    expect(ok('select', 'c1', { choices: [{ id: 'c1', label: 'A' }] })).toBe(true);
    expect(ok('select', 'c2', { choices: [{ id: 'c1', label: 'A' }] })).toBe(false);
    expect(ok('user', '0192b3c4-0000-7000-8000-000000000001')).toBe(true);
    expect(ok('user', 'u1')).toBe(false);
    expect(ok('url', 'https://example.com/a')).toBe(true);
    expect(ok('url', 'javascript:alert(1)')).toBe(false);
    expect(ok('money', 12345, { currency: 'RUB' })).toBe(true);
    expect(ok('money', 1.5, { currency: 'RUB' })).toBe(false);
    expect(ok('text', null)).toBe(false);
  });
});

describe('F-filter: правила field:', () => {
  const def = (id: string, type: string, options: Record<string, unknown> = {}) =>
    ({ id, type, options, projectId: 'p', spaceId: 's', name: id, rank: 'a0' }) as never;
  const fieldDefs = [
    def('f1', 'number'),
    def('f2', 'select', { choices: [{ id: 'c1', label: 'A' }] }),
  ];
  const ctx = { statuses: [], userId: 'u1', today: '2026-10-23', fieldDefs } as never;
  const t = (f: Record<string, unknown>) =>
    ({
      statusId: 'st1',
      priority: 0,
      dueDate: null,
      title: 't',
      createdBy: 'u2',
      assigneeIds: [],
      labelIds: [],
      fields: f,
    }) as never;
  const m = (f: Record<string, unknown>, rule: Record<string, unknown>) =>
    matchFilter(t(f), { op: 'and', rules: [rule] } as never, ctx);
  it('gte/lte, in, isEmpty, удалённое поле пропускается', () => {
    expect(m({ f1: 5 }, { field: 'field:f1', operator: 'gte', value: 5 })).toBe(true);
    expect(m({ f1: 5 }, { field: 'field:f1', operator: 'lte', value: 4 })).toBe(false);
    expect(m({ f2: 'c1' }, { field: 'field:f2', operator: 'in', value: ['c1'] })).toBe(true);
    expect(m({}, { field: 'field:f2', operator: 'isEmpty' })).toBe(true);
    expect(m({ f2: 'c1' }, { field: 'field:f2', operator: 'isEmpty' })).toBe(false);
    expect(m({}, { field: 'field:gone', operator: 'isNotEmpty' })).toBe(true);
  });
});
