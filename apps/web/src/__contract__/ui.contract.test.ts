// @vitest-environment node
// Контрактный тест web (C-ui): сверяет код с docs/contracts/web.md.
// Правит только координатор модуля web.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UI_CONTRACT_VERSIONS } from '../contract';
import * as ui from '../ui/index';
import { EXTENSION_KINDS } from '../modules/types';
import { registerModules } from '../modules/registry';

const doc = readFileSync(new URL('../../../../docs/contracts/web.md', import.meta.url), 'utf8');
const css = readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8');

const section = (title: string): string => {
  const m = doc.match(
    new RegExp(`^### ${title}[^\\n]*\\n([\\s\\S]*?)(?=^### |^## |(?![\\s\\S]))`, 'm'),
  );
  if (!m) throw new Error(`нет раздела «${title}» в контракте`);
  return m[1];
};
const tableNames = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1]);
const block = (selector: RegExp): string => {
  const m = css.match(selector);
  if (!m) throw new Error(`нет блока ${selector} в tokens.css`);
  return m[1];
};
const declared = (text: string): Set<string> =>
  new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

describe('C-ui: версия', () => {
  it('UI_CONTRACT_VERSIONS совпадает с заголовками ## C-… vN', () => {
    const fromDoc = Object.fromEntries(
      [...doc.matchAll(/^## (C-[\w-]+) v(\d+)\s*$/gm)].map((m) => [m[1], Number(m[2])]),
    );
    expect(UI_CONTRACT_VERSIONS).toEqual(fromDoc);
  });
});

describe('C-ui: токены', () => {
  const light = declared(block(/@theme\s*\{([\s\S]*?)\n\}/));
  const dark = declared(block(/\.dark\s*\{([\s\S]*?)\n\}/));
  const colors = tableNames(section('Токены цвета'), /^\| `(--color-[\w-]+)`/gm);
  const scale = tableNames(section('Шрифты, отступы, размеры'), /^\| `(--[\w-]+)`/gm);

  it('в контракте есть токены', () => {
    expect(colors.length).toBeGreaterThan(10);
    expect(scale.length).toBeGreaterThan(5);
  });
  it.each(colors)('%s — в светлой и тёмной теме', (t) => {
    expect(light.has(t), `${t} нет в @theme`).toBe(true);
    expect(dark.has(t), `${t} нет в .dark`).toBe(true);
  });
  it.each(scale)('%s — в @theme', (t) => {
    expect(light.has(t)).toBe(true);
  });
});

describe('C-ui: компоненты', () => {
  const names = tableNames(section('Базовые компоненты'), /^\| `(\w+)` \|/gm);
  it('список из контракта', () => {
    expect(names).toEqual([
      'Button',
      'Input',
      'Select',
      'Popover',
      'Dialog',
      'Menu',
      'Avatar',
      'Badge',
      'Tooltip',
    ]);
  });
  it.each([...names, 'useBreakpoint', 'useTheme'])('экспорт %s', (n) => {
    expect((ui as Record<string, unknown>)[n], `ui/index.ts не экспортирует ${n}`).toBeDefined();
  });
});

describe('C-ui: точки расширения', () => {
  it('EXTENSION_KINDS = список из контракта', () => {
    const m = section('Точки расширения').match(/EXTENSION_KINDS = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const fromDoc = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    // work.md §C-modules v3 (WK-0): += nav, topbar; collab.md §X-core п. 5 (C-ui v2): += search
    expect([...EXTENSION_KINDS]).toEqual([...fromDoc, 'nav', 'topbar', 'search']);
  });
  it('дубликат ключа элемента → Error', () => {
    const cmd = { id: 'a', label: 'x', run: () => {} };
    expect(() => registerModules([{ id: 'dup', commands: [cmd, cmd] }])).toThrow();
  });
  it('маршрут вне /m/<id>/ → Error', () => {
    expect(() =>
      registerModules([
        {
          id: 'bad',
          routes: [{ path: '/other', component: () => Promise.resolve({ default: {} }) }],
        },
      ]),
    ).toThrow();
  });
});
