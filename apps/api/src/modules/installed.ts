import type { BackendModuleManifest } from '@planar/shared';
import type { PgTable } from 'drizzle-orm/pg-core';
import { api as chat } from '@planar/module-chat/api';
import * as chatTables from '@planar/module-chat/api/schema';
import { api as docs } from '@planar/module-docs/api';
import * as docsTables from '@planar/module-docs/api/schema';
import { api as hello } from '@planar/module-hello/api';
import * as helloTables from '@planar/module-hello/api/schema';
import { api as timeApi } from '@planar/module-time/api';
import * as timeTables from '@planar/module-time/api/schema';
import { api as sprintsApi } from '@planar/module-sprints/api';
import * as sprintsTables from '@planar/module-sprints/api/schema';
import { api as automationsApi } from '@planar/module-automations/api';
import * as automationsTables from '@planar/module-automations/api/schema';
import { api as webhooksApi } from '@planar/module-webhooks/api';
import * as webhooksTables from '@planar/module-webhooks/api/schema';
import { api as gitlabApi } from '@planar/module-gitlab/api';
import * as gitlabTables from '@planar/module-gitlab/api/schema';
import { api as importApi } from '@planar/module-import/api';
import * as importTables from '@planar/module-import/api/schema';

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
    for (const [e, ent] of Object.entries(m.api.entities)) {
      if (!m.tables[e])
        throw new Error(`module "${id}": нет таблицы для сущности "${e}" в api/schema.ts`);
      const mb = ent.meta.members as Record<string, unknown> | undefined;
      if (
        mb &&
        !(['entity', 'key', 'container', 'via'] as const).every(
          (k) => typeof mb[k] === 'string' && mb[k],
        )
      )
        throw new Error(`module "${id}": неверная форма meta.members сущности "${e}"`);
    }
  }
  return list;
}

export const installed: InstalledModule[] = validateInstalled([
  { api: hello, tables: helloTables },
  { api: timeApi, tables: timeTables },
  { api: sprintsApi, tables: sprintsTables },
  { api: automationsApi, tables: automationsTables },
  { api: webhooksApi, tables: webhooksTables },
  { api: importApi, tables: importTables },
  { api: gitlabApi, tables: gitlabTables },
  { api: docs, tables: docsTables },
  { api: chat, tables: chatTables },
]);

export const moduleTables = (): Map<string, PgTable> =>
  new Map(
    installed.flatMap((m) =>
      Object.keys(m.api.entities).map((e) => [e, m.tables[e] as PgTable] as const),
    ),
  );
