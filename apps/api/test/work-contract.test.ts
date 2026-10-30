// Contract test work: checks the work modules against docs/contracts/work.md. Edited only by the work coordinator.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { installed } from '../src/modules/installed.js';

const doc = readFileSync(new URL('../../../docs/contracts/work.md', import.meta.url), 'utf8');
const MODULES = ['time', 'sprints', 'automations', 'webhooks', 'import'];

/** Section "## Module <id> …" up to the next "## ". */
const section = (id: string) =>
  new RegExp(`^## Модуль ${id} [^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(doc)?.[1] ??
  '';

const entitiesOf = (sec: string) =>
  [
    ...sec.matchAll(
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
      nullable: f[2].trim().endsWith('?'),
      json: f[2].trim() === 'json',
    })),
  }));

const mutatorsOf = (id: string, sec: string) =>
  [...sec.matchAll(new RegExp(`^\\| \`(${id}\\.\\w+)\` \\|`, 'gm'))].map((m) => m[1]).sort();

type Parser = { safeParse(v: unknown): { success: boolean } };

for (const id of MODULES) {
  const sec = section(id);
  const mod = installed.find((m) => m.api.id === id);
  describe(`module ${id}`, () => {
    // skeleton (WK-S): the module is installed but still empty — its own task fills it
    const empty = mod && !Object.keys(mod.api.entities).length && !mod.api.mutators.length;
    if (!mod || empty) {
      it.todo(`модуль ${id} ещё не установлен или пуст`);
      return;
    }
    it('набор сущностей = контракт', () => {
      expect(Object.keys(mod.api.entities).sort()).toEqual(
        entitiesOf(sec)
          .map((e) => e.name)
          .sort(),
      );
    });
    for (const e of entitiesOf(sec)) {
      it(`entity ${e.name}: поля, nullability, meta`, () => {
        const ent = mod.api.entities[e.name];
        expect(ent, `нет сущности ${e.name}`).toBeDefined();
        const shape = (ent.schema as unknown as { shape: Record<string, Parser> }).shape;
        expect(Object.keys(shape).sort()).toEqual(e.fields.map((f) => f.name).sort());
        for (const f of e.fields)
          if (!f.json)
            expect(shape[f.name].safeParse(null).success, `${e.name}.${f.name}`).toBe(f.nullable);
        expect(ent.meta).toEqual(e.meta);
      });
    }
    it('имена мутаторов = контракт', () => {
      expect(mod.api.mutators.map((m) => m.name).sort()).toEqual(mutatorsOf(id, sec));
    });
  });
}

describe('webhook signature', () => {
  const m = /^```json example=webhook\.signature\n([\s\S]*?)^```/m.exec(doc);
  it('эталон подписи совпадает с HMAC-SHA256', () => {
    const v = JSON.parse(m![1]) as { secret: string; body: string; signature: string };
    expect('sha256=' + createHmac('sha256', v.secret).update(v.body).digest('hex')).toBe(
      v.signature,
    );
  });
});
