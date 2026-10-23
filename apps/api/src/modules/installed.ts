import type { BackendModuleManifest } from '@planar/shared';
import type { PgTable } from 'drizzle-orm/pg-core';
import { api as hello } from '@planar/module-hello/api';
import * as helloTables from '@planar/module-hello/api/schema';

export interface InstalledModule {
  api: BackendModuleManifest;
  /** api/schema.ts модуля: ключ = имя сущности */
  tables: Record<string, unknown>;
}

/** Явный реестр: добавление модуля = строка здесь + зависимость в package.json (C-modules). */
export const installed: InstalledModule[] = [{ api: hello, tables: helloTables }];

export const moduleTables = (): Map<string, PgTable> =>
  new Map(
    installed.flatMap((m) =>
      Object.keys(m.api.entities).map((e) => [e, m.tables[e] as PgTable] as const),
    ),
  );
