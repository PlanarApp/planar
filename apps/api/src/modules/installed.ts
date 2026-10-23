import type { BackendModuleManifest } from '@planar/shared';
import type { PgTable } from 'drizzle-orm/pg-core';
import { chatApi } from '@planar/module-chat/api';
import * as chatTables from '@planar/module-chat/api/schema';
import { api as docs } from '@planar/module-docs/api';
import * as docsTables from '@planar/module-docs/api/schema';
import { api as hello } from '@planar/module-hello/api';
import * as helloTables from '@planar/module-hello/api/schema';
import { DB } from '../tokens.js';

export interface InstalledModule {
  api: BackendModuleManifest;
  /** api/schema.ts модуля: ключ = имя сущности */
  tables: Record<string, unknown>;
}

/** Явный реестр: добавление модуля = строка здесь + зависимость в package.json (C-modules). */
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
/** Префиксы маршрутов ядра: модуль с таким id выключал бы их через guard. */
const RESERVED = [
  'auth',
  'setup',
  'users',
  'sync',
  'files',
  'push',
  'modules',
  'tasks',
  'health',
  'v1',
  'mcp',
];

/** Проверка при загрузке: id по C-modules, не маршрут ядра, у каждой сущности есть таблица. */
export function validateInstalled(list: InstalledModule[]): InstalledModule[] {
  for (const m of list) {
    const id = m.api.id;
    if (!ID_RE.test(id)) throw new Error(`module "${id}": id не соответствует ${ID_RE}`);
    if (RESERVED.includes(id)) throw new Error(`module "${id}": id совпадает с маршрутом ядра`);
    for (const e of Object.keys(m.api.entities))
      if (!m.tables[e])
        throw new Error(`module "${id}": нет таблицы для сущности "${e}" в api/schema.ts`);
  }
  return list;
}

export const installed: InstalledModule[] = validateInstalled([
  { api: hello, tables: helloTables },
  { api: docs, tables: docsTables },
  { api: chatApi(DB), tables: chatTables },
]);

export const moduleTables = (): Map<string, PgTable> =>
  new Map(
    installed.flatMap((m) =>
      Object.keys(m.api.entities).map((e) => [e, m.tables[e] as PgTable] as const),
    ),
  );
