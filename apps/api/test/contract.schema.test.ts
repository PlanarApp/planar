// Contract test C-schema: DB schema after migrations = docs/contracts/core.md.
// Edited only by the core module coordinator.
import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docEntities, docServerTables, snake } from '../../../packages/shared/test/contract-doc.js';
import { testDb } from './db.js';

type Col = {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
  data_type: string;
  udt_name: string;
  collation_name: string | null;
};
type Idx = { table: string; cols: string[]; unique: boolean };

const PG_TYPE: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  int: 'integer',
  bool: 'boolean',
  ts: 'timestamp with time zone',
  date: 'date',
  rank: 'text',
  obj: 'jsonb',
  json: 'jsonb',
  doc: 'jsonb',
  'uuid[]': 'ARRAY',
  'text[]': 'ARRAY', // projects.modules (C-schema v16)
};
const pgType = (entity: string, field: string, type: string) => {
  const t = type.replace(/\?$/, '');
  if (entity === 'attachments' && field === 'size') return 'bigint';
  return t.startsWith('enum(') ? 'text' : PG_TYPE[t];
};

const db = testDb();
let cols: Col[] = [];
let idx: Idx[] = [];
afterAll(() => db.$client.end());
beforeAll(async () => {
  cols = (
    await db.$client.query<Col>(
      `select table_name, column_name, is_nullable, data_type, udt_name, collation_name
         from information_schema.columns where table_schema = 'public'`,
    )
  ).rows;
  idx = (
    await db.$client.query<Idx>(
      `select t.relname as "table", i.indisunique as "unique",
              array(select a.attname from unnest(i.indkey) with ordinality k(n, o)
                    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.n order by k.o)::text[] as cols
         from pg_index i join pg_class t on t.oid = i.indrelid join pg_namespace s on s.oid = t.relnamespace
        where s.nspname = 'public'`,
    )
  ).rows;
});
const tableCols = (t: string) => cols.filter((c) => c.table_name === t);

describe('contract schema', () => {
  for (const e of docEntities) {
    const table = snake(e.name);
    it(`schema ${table}: колонки, типы, null, индексы`, () => {
      const got = tableCols(table);
      expect(got.length, `нет таблицы ${table}`).toBeGreaterThan(0);
      expect(got.map((c) => c.column_name).sort()).toEqual(
        [...e.fields.map((f) => snake(f.name)), ...e.dbOnly].sort(),
      );
      for (const f of e.fields) {
        const c = got.find((x) => x.column_name === snake(f.name))!;
        const where = `${table}.${c.column_name}`;
        expect(c.data_type, where).toBe(pgType(e.name, f.name, f.type));
        if (f.type === 'uuid[]' || f.type === 'uuid[]?') expect(c.udt_name, where).toBe('_uuid');
        if (f.type === 'text[]') expect(c.udt_name, where).toBe('_text');
        expect(c.is_nullable === 'YES', `${where} nullable`).toBe(f.nullable);
        if (f.type === 'rank') expect(c.collation_name, `${where} COLLATE "C"`).toBe('C');
      }
      const ti = idx.filter((i) => i.table === table);
      expect(
        ti.some((i) => i.unique && i.cols.length === 1 && i.cols[0] === 'id'),
        `${table}: pk id`,
      ).toBe(true);
      for (const field of e.meta.indexes) {
        expect(
          ti.some((i) => i.cols[0] === snake(field)),
          `${table}: индекс по ${snake(field)}`,
        ).toBe(true);
      }
      for (const f of e.fields) {
        const tuple = /unique \(([\w, ]+)\)/.exec(f.note);
        const want = tuple
          ? tuple[1].split(',').map((c) => snake(c.trim()))
          : /\bunique\b(?! index)/.test(f.note)
            ? [snake(f.name)]
            : null;
        if (!want) continue;
        expect(
          ti.some((i) => i.unique && [...i.cols].sort().join() === [...want].sort().join()),
          `${table}: unique (${want.join(', ')})`,
        ).toBe(true);
      }
    });
  }

  for (const t of docServerTables) {
    it(`schema ${t.name}: колонки и null`, () => {
      const got = tableCols(t.name);
      expect(got.length, `нет таблицы ${t.name}`).toBeGreaterThan(0);
      expect(got.map((c) => c.column_name).sort()).toEqual(t.columns.map((c) => c.name).sort());
      for (const c of t.columns) {
        expect(
          got.find((x) => x.column_name === c.name)!.is_nullable === 'YES',
          `${t.name}.${c.name} nullable`,
        ).toBe(c.nullable);
      }
    });
  }

  it('schema: нет лишних таблиц', () => {
    const known = new Set([
      ...docEntities.map((e) => snake(e.name)),
      ...docServerTables.map((t) => t.name),
    ]);
    // module tables (C-modules): prefix <moduleId>_ of the modules/<id> catalog
    const modulePrefixes = readdirSync(new URL('../../../modules', import.meta.url), {
      withFileTypes: true,
    })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.replace(/-/g, '_') + '_');
    const extra = [...new Set(cols.map((c) => c.table_name))].filter(
      (t) =>
        !known.has(t) && !t.startsWith('__drizzle') && !modulePrefixes.some((p) => t.startsWith(p)),
    );
    expect(extra).toEqual([]);
  });
});
