import { Module } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';

@Module({})
class DocsModule {}

type Q = { execute(q: SQL): Promise<{ rows: unknown[] }> };

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: DocsModule,
  mutators: shared.mutators,
  entities: shared.entities,
  // файл на странице пространства пользователя и загружен кем-то из участников этого пространства
  async canReadFile(q, userId, sha256) {
    const r = await (q as Q).execute(sql`
      select 1 from docs_pages p
      join space_members me on me.space_id = p.space_id and me.user_id = ${userId}
      where p.files @> ${JSON.stringify([sha256])}::jsonb
        and exists (
          select 1 from file_uploads fu
          join space_members m on m.user_id = fu.user_id and m.space_id = p.space_id
          where fu.sha256 = ${sha256})
      limit 1`);
    return r.rows.length > 0;
  },
};
