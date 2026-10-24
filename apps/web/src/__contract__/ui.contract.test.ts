// @vitest-environment node
// Контрактный тест C-ui: сверяет код с docs/contracts/design.md (версии — и с web.md).
// Правит только координатор модуля design.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UI_CONTRACT_VERSIONS } from '../contract';
import * as ui from '../ui/index';
import { EXTENSION_KINDS } from '../modules/types';
import { registerModules } from '../modules/registry';

const read = (f: string) =>
  readFileSync(new URL(`../../../../docs/contracts/${f}`, import.meta.url), 'utf8');
const doc = read('design.md');
const versions = doc + read('web.md');
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
      [...versions.matchAll(/^## (C-[\w-]+) v(\d+)\s*$/gm)].map((m) => [m[1], Number(m[2])]),
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

describe('C-ui: контраст (WCAG 2.1)', () => {
  const themes = {
    light: block(/@theme\s*\{([\s\S]*?)\n\}/),
    dark: block(/\.dark\s*\{([\s\S]*?)\n\}/),
  };
  const values = (text: string): Map<string, string> =>
    new Map([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = values(themes.light);
  const resolve = (vars: Map<string, string>, name: string, depth = 0): string => {
    const v = vars.get(name) ?? light.get(name);
    if (!v) throw new Error(`${name} не объявлен`);
    const ref = v.match(/^var\((--[\w-]+)\)$/);
    if (ref && depth < 10) return resolve(vars, ref[1], depth + 1);
    if (!/^#[0-9a-f]{6}$/i.test(v))
      throw new Error(`${name}: ${v} — ожидается #rrggbb или var(--…)`);
    return v;
  };
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const pairs = [
    ...section('Контраст').matchAll(
      /^\| `(--color-[\w-]+)` \| `(--color-[\w-]+)` \| ([\d.]+) \|/gm,
    ),
  ].map((m) => [m[1], m[2], Number(m[3])] as const);

  it('в контракте есть пары', () => {
    expect(pairs.length).toBeGreaterThan(15);
  });
  it('проверка яркости: чёрный/белый = 21', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  for (const [theme, text] of Object.entries(themes)) {
    const vars = values(text);
    it.each(pairs)(`${theme}: %s на %s ≥ %s`, (fg, bg, min) => {
      expect(ratio(resolve(vars, fg), resolve(vars, bg))).toBeGreaterThanOrEqual(min);
    });
  }
});

describe('C-ui: компоненты', () => {
  const names = tableNames(section('Базовые компоненты'), /^\| `(\w+)` \|/gm);
  it('список из контракта', () => {
    expect(names).toEqual([
      'Button',
      'IconButton',
      'Input',
      'Select',
      'Menu',
      'Popover',
      'Dialog',
      'ConfirmDialog',
      'Tabs',
      'Chip',
      'Avatar',
      'AvatarStack',
      'Badge',
      'Kbd',
      'EmptyState',
      'Toolbar',
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
    expect([...EXTENSION_KINDS]).toEqual(fromDoc);
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
