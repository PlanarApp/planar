import { describe, expect, it } from 'vitest';
import en from '../en';
import ru from '../ru';

type Tree = { [k: string]: string | Tree };
const leaves = (t: Tree, path = ''): [string, string][] =>
  Object.entries(t).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${path}${k}`, v] as [string, string]] : leaves(v, `${path}${k}.`),
  );

// lite.ts поддерживает только {name} и {'литерал'}: остальной синтаксис vue-i18n молча не сработает.
const ok = (s: string) => {
  const rest = s.replace(/\{(?:'[^']*'|\w+)\}/g, '');
  return !/[{}|]|@[.:]|%|\$t/.test(rest);
};

describe('i18n: строки ru/en в синтаксисе lite', () => {
  for (const [name, tree] of [
    ['ru', ru],
    ['en', en],
  ] as const) {
    it(name, () => {
      expect(leaves(tree as Tree).filter(([, v]) => !ok(v))).toEqual([]);
    });
  }
  it('сторож ловит неподдержанное', () => {
    for (const bad of ['a | b', '@:x.y', '{n, plural}', '{0}x}', '%{n}'])
      expect(ok(bad)).toBe(false);
    expect(ok("{'@'} и {who}")).toBe(true);
  });
});
