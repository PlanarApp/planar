// Контрактный тест core: сверяет код контрактов с docs/contracts/core.md.
// Правит только координатор модуля core (см. «Контрактный тест» в docs/contracts/core.md).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSIONS, ENTITIES, contractSchemas, entitySchemas } from '../src/index';

const doc = readFileSync(new URL('../../../docs/contracts/core.md', import.meta.url), 'utf8');

describe('contract versions', () => {
  it('CONTRACT_VERSIONS совпадает с заголовками ## C-… vN', () => {
    const fromDoc = Object.fromEntries(
      [...doc.matchAll(/^## (C-[\w-]+) v(\d+)\s*$/gm)].map((m) => [m[1], Number(m[2])]),
    );
    expect(Object.keys(fromDoc).length).toBeGreaterThan(0);
    expect(CONTRACT_VERSIONS).toEqual(fromDoc);
  });
});

const blocks = [...doc.matchAll(/^```json (example|bad)=([\w.]+)\n([\s\S]*?)^```/gm)].map((m) => ({
  kind: m[1] as 'example' | 'bad',
  name: m[2],
  json: JSON.parse(m[3]) as unknown,
}));

describe('contract examples', () => {
  it('у каждой схемы contractSchemas есть пример, у каждого примера — схема', () => {
    const named = new Set(blocks.filter((b) => b.kind === 'example').map((b) => b.name));
    expect([...named].sort()).toEqual(Object.keys(contractSchemas).sort());
  });

  blocks.forEach((b, i) => {
    it(`${b.kind} ${b.name} #${i}`, () => {
      const schema = (contractSchemas as Record<string, { safeParse(v: unknown): { success: boolean } }>)[b.name];
      expect(schema, `нет схемы ${b.name}`).toBeDefined();
      expect(schema.safeParse(b.json).success).toBe(b.kind === 'example');
    });
  });
});

type DocEntity = {
  name: string;
  meta: { scope: string; write: string; bootstrap: boolean; indexes: string[] };
  fields: { name: string; type: string }[];
};

const docEntities: DocEntity[] = [
  ...doc.matchAll(
    /^#### (\w+)\nscope: (\S+) · write: (\S+) · bootstrap: (yes|no) · indexes: (.+)\n\n((?:\|.*\n)+)/gm,
  ),
].map((m) => ({
  name: m[1],
  meta: {
    scope: m[2],
    write: m[3],
    bootstrap: m[4] === 'yes',
    indexes: m[5].trim() === '—' ? [] : m[5].split(',').map((s) => s.trim()),
  },
  fields: [...m[6].matchAll(/^\| `(\w+)` \| ([^|]+) \|/gm)].map((f) => ({ name: f[1], type: f[2].trim() })),
}));

describe('contract entities', () => {
  it('набор сущностей entitySchemas и ENTITIES = раздел «Сущности»', () => {
    const names = docEntities.map((e) => e.name).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(entitySchemas).sort()).toEqual(names);
    expect(Object.keys(ENTITIES).sort()).toEqual(names);
  });

  for (const e of docEntities) {
    it(`entity ${e.name}: поля, nullability, meta`, () => {
      const schema = (entitySchemas as Record<string, { shape: Record<string, { safeParse(v: unknown): { success: boolean } }> }>)[e.name];
      expect(schema, `нет entitySchemas.${e.name}`).toBeDefined();
      expect(Object.keys(schema.shape).sort()).toEqual(e.fields.map((f) => f.name).sort());
      for (const f of e.fields) {
        const nullable = f.type.endsWith('?');
        if (f.type === 'json') continue; // любой JSON, null допустим по определению
        expect(schema.shape[f.name].safeParse(null).success, `${e.name}.${f.name}: ${f.type}`).toBe(nullable);
      }
      expect((ENTITIES as Record<string, unknown>)[e.name]).toEqual(e.meta);
    });
  }
});
