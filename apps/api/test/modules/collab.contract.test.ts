// Contract test collab: module entities and mutators = docs/contracts/collab.md. Edited only by the collab coordinator.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { installed } from '../../src/modules/installed.js';

type Parser = { safeParse(v: unknown): { success: boolean } };

const doc = readFileSync(new URL('../../../../docs/contracts/collab.md', import.meta.url), 'utf8');

const entities = [
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
  fields: [...m[6].matchAll(/^\| `(\w+)` \| ([^|]+) \|/gm)].map((f) => ({
    name: f[1],
    type: f[2].trim(),
    nullable: f[2].trim().endsWith('?'),
  })),
}));

const mutators = [...doc.matchAll(/^\| `([\w.]+)` \| `([^`]*)` \|/gm)].map((r) => ({
  name: r[1],
  args: r[2]
    .replace(/\{[^}]*\}/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ name: t.split(/[?:\s]/)[0], optional: /^\w+\?/.test(t) })),
}));

// module by prefix: docsPages → docs, docs.page.create → docs
const moduleIds = [
  ...new Set([
    ...entities.map((e) => /^[a-z]+/.exec(e.name)![0]),
    ...mutators.map((m) => m.name.split('.')[0]),
  ]),
];

for (const id of moduleIds) {
  describe(`collab contract: модуль ${id}`, () => {
    const mod = installed.find((m) => m.api.id === id)?.api;
    const docEntities = entities.filter((e) => /^[a-z]+/.exec(e.name)![0] === id);
    const docMutators = mutators.filter((m) => m.name.split('.')[0] === id);

    it('модуль установлен (apps/api/src/modules/installed.ts)', () => {
      expect(mod, `нет модуля ${id}`).toBeDefined();
    });

    it('набор сущностей = контракт', () => {
      expect(Object.keys(mod?.entities ?? {}).sort()).toEqual(
        docEntities.map((e) => e.name).sort(),
      );
    });

    for (const e of docEntities) {
      it(`сущность ${e.name}: поля, nullability, meta`, () => {
        const ent = mod?.entities[e.name] as
          { schema: { shape: Record<string, Parser> }; meta: Record<string, unknown> } | undefined;
        expect(ent, `нет сущности ${e.name}`).toBeDefined();
        const shape = ent!.schema.shape;
        expect(Object.keys(shape).sort()).toEqual(e.fields.map((f) => f.name).sort());
        for (const f of e.fields) {
          if (f.type === 'json') continue; // any JSON; null is allowed by definition
          expect(shape[f.name].safeParse(null).success, `${e.name}.${f.name}: ${f.type}`).toBe(
            f.nullable,
          );
        }
        const { scope, write, bootstrap, indexes } = ent!.meta;
        expect({ scope, write, bootstrap, indexes }).toEqual(e.meta);
      });
    }

    it('набор мутаторов = контракт', () => {
      expect((mod?.mutators ?? []).map((m) => m.name).sort()).toEqual(
        docMutators.map((m) => m.name).sort(),
      );
    });

    for (const dm of docMutators) {
      it(`мутатор ${dm.name}: args`, () => {
        const def = mod?.mutators.find((m) => m.name === dm.name);
        expect(def, `нет мутатора ${dm.name}`).toBeDefined();
        const shape = (def!.args as unknown as { shape: Record<string, Parser> }).shape;
        expect(Object.keys(shape).sort()).toEqual(dm.args.map((a) => a.name).sort());
        for (const a of dm.args)
          expect(shape[a.name].safeParse(undefined).success, `${dm.name}.${a.name}`).toBe(
            a.optional,
          );
      });
    }
  });
}
