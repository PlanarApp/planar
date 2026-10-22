// Разбор docs/contracts/core.md для контрактных тестов. Правит только координатор core.
import { readFileSync } from 'node:fs';

export const contractDoc = readFileSync(
  new URL('../../../docs/contracts/core.md', import.meta.url),
  'utf8',
);

export const docVersions: Record<string, number> = Object.fromEntries(
  [...contractDoc.matchAll(/^## (C-[\w-]+) v(\d+)\s*$/gm)].map((m) => [m[1], Number(m[2])]),
);

export const docBlocks = [
  ...contractDoc.matchAll(/^```json (example|bad)=([\w.]+)\n([\s\S]*?)^```/gm),
].map((m) => ({
  kind: m[1] as 'example' | 'bad',
  name: m[2],
  json: JSON.parse(m[3]) as unknown,
}));

export interface DocField {
  name: string;
  type: string;
  nullable: boolean;
  note: string;
}
export interface DocEntity {
  name: string;
  meta: { scope: string; write: string; bootstrap: boolean; indexes: string[] };
  fields: DocField[];
  /** колонки «Только в БД: `col type …`» после таблицы */
  dbOnly: string[];
}

export const docEntities: DocEntity[] = [
  ...contractDoc.matchAll(
    /^#### (\w+)\nscope: (\S+) · write: (\S+) · bootstrap: (yes|no) · indexes: (.+)\n\n((?:\|.*\n)+)((?:(?!^#{2,4} )[\s\S])*)/gm,
  ),
].map((m) => ({
  name: m[1],
  meta: {
    scope: m[2],
    write: m[3],
    bootstrap: m[4] === 'yes',
    indexes: m[5].trim() === '—' ? [] : m[5].split(',').map((s) => s.trim()),
  },
  fields: [...m[6].matchAll(/^\| `(\w+)` \| ([^|]+) \|([^|]*)\|/gm)].map((f) => ({
    name: f[1],
    type: f[2].trim(),
    nullable: f[2].trim().endsWith('?'),
    note: f[3].trim(),
  })),
  dbOnly: [...m[7].matchAll(/^Только в БД: `(\w+)/gm)].map((d) => d[1]),
}));

export interface DocServerTable {
  name: string;
  columns: { name: string; nullable: boolean }[];
}

/** Таблица «Несинхронизируемые таблицы»: `| \`имя\` | \`col type?\`, … |` */
export const docServerTables: DocServerTable[] = (() => {
  const sec = /^### Несинхронизируемые таблицы[^\n]*\n([\s\S]*?)(?=^#{2,3} )/m.exec(contractDoc);
  if (!sec) return [];
  return [...sec[1].matchAll(/^\| `(\w+)` \| (.+) \|$/gm)].map((r) => ({
    name: r[1],
    columns: [...r[2].matchAll(/`([^`]+)`/g)]
      .map((c) => c[1])
      .filter((c) => !c.startsWith('('))
      .map((c) => ({ name: c.split(/\s+/)[0].replace(/\?$/, ''), nullable: c.includes('?') })),
  }));
})();

export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
