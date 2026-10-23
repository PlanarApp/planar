// Контрактный тест core: сверяет код контрактов с docs/contracts/core.md.
// Правит только координатор модуля core (см. «Контрактный тест» в docs/contracts/core.md).
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSIONS, ENTITIES, contractSchemas, entitySchemas } from '../src/index';
import { docBlocks, docEntities, docVersions } from './contract-doc';

type Parser = { safeParse(v: unknown): { success: boolean } };

describe('contract versions', () => {
  it('CONTRACT_VERSIONS совпадает с заголовками ## C-… vN', () => {
    expect(Object.keys(docVersions).length).toBeGreaterThan(0);
    expect(CONTRACT_VERSIONS).toEqual(docVersions);
  });
});

describe('contract examples', () => {
  it('у каждой схемы contractSchemas есть пример, у каждого примера — схема', () => {
    const named = new Set(docBlocks.filter((b) => b.kind === 'example').map((b) => b.name));
    expect([...named].sort()).toEqual(Object.keys(contractSchemas).sort());
  });

  docBlocks.forEach((b, i) => {
    it(`${b.kind} ${b.name} #${i}`, () => {
      const schema = (contractSchemas as Record<string, Parser>)[b.name];
      expect(schema, `нет схемы ${b.name}`).toBeDefined();
      expect(schema.safeParse(b.json).success).toBe(b.kind === 'example');
    });
  });
});

describe('contract entities', () => {
  it('набор сущностей entitySchemas и ENTITIES = раздел «Сущности»', () => {
    const names = docEntities.map((e) => e.name).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(entitySchemas).sort()).toEqual(names);
    expect(Object.keys(ENTITIES).sort()).toEqual(names);
  });

  for (const e of docEntities) {
    it(`entity ${e.name}: поля, nullability, meta`, () => {
      const schema = (entitySchemas as Record<string, { shape: Record<string, Parser> }>)[e.name];
      expect(schema, `нет entitySchemas.${e.name}`).toBeDefined();
      expect(Object.keys(schema.shape).sort()).toEqual(e.fields.map((f) => f.name).sort());
      for (const f of e.fields) {
        if (f.type === 'json') continue; // любой JSON, null допустим по определению
        expect(schema.shape[f.name].safeParse(null).success, `${e.name}.${f.name}: ${f.type}`).toBe(f.nullable);
      }
      expect((ENTITIES as Record<string, unknown>)[e.name]).toEqual(e.meta);
    });
  }
});
