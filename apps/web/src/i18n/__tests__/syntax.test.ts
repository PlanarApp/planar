import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../en';
import ru from '../ru';

type Tree = { [k: string]: string | Tree };
const leaves = (t: Tree, path = ''): [string, string][] =>
  Object.entries(t).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${path}${k}`, v] as [string, string]] : leaves(v, `${path}${k}.`),
  );

// lite.ts supports only {name} and {'literal'}: other vue-i18n syntax silently won't work.
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

  it('ключи ru и en совпадают', () => {
    const keys = (t: unknown) =>
      leaves(t as Tree)
        .map(([k]) => k)
        .sort();
    expect(keys(en)).toEqual(keys(ru));
  });

  it('в src нет API vue-i18n, которого нет в lite', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? e.name === '__tests__' || e.name === '__contract__'
            ? []
            : files(join(dir, e.name))
          : /\.(ts|vue)$/.test(e.name) && !/\.test\.ts$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const bad: string[] = [];
    for (const f of files(join(__dirname, '..', '..'))) {
      const src = readFileSync(f, 'utf8');
      // useI18n() returns only t, te, locale; i18n.global — only t, te, locale
      for (const m of src.matchAll(/const \{([^}]*)\} = useI18n\(/g))
        for (const n of m[1].split(',').map((x) => x.trim().split(':')[0].trim()))
          if (n && !['t', 'te', 'locale'].includes(n)) bad.push(`${f}: useI18n ${n}`);
      for (const m of src.matchAll(/i18n\.global\.(\w+)/g))
        if (!['t', 'te', 'locale'].includes(m[1])) bad.push(`${f}: global.${m[1]}`);
      if (/\$(t|tc|te|d|n|rt)\(|<i18n-t|\bv-t\b|\bt\([^()]*,\s*\d+\s*\)/.test(src))
        bad.push(`${f}: шаблонный/плюральный вызов`);
    }
    expect(bad).toEqual([]);
  });
});
