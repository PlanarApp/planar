import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { buildMutations, diffOf, writeKeys } from './harness.js';

const body = z.object({
  projectId: z.uuid(),
  packPageId: z.uuid(),
  /** status key to delete → key of the status its tasks move to */
  replaceWith: z.record(z.string(), z.string()).optional(),
});

/** A mutator error (Reject: a string code) → 400; the rest goes outward as is. */
const asHttp = (e: unknown) => {
  const code = (e as { code?: unknown }).code;
  if (e instanceof HttpError || typeof code !== 'string') return e;
  return new HttpError(
    code === 'conflict' ? 409 : 400,
    code === 'conflict' ? 'conflict' : 'invalid_request',
    (e as Error).message,
  );
};

@Controller('api/ai/harness')
export class HarnessController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** Admin of the project with the module on; session only. No such project and no right look the same for outsiders. */
  private async admin(req: object, projectId: string) {
    const a = this.core.auth(req);
    if (a.tokenId) throw new HttpError(403, 'forbidden', 'Только из сессии');
    const r = await this.core.db.execute(
      sql`select (project_role(${a.userId}::uuid, p.id) = 'admin' and 'ai' = any(p.modules)) as ok
          from projects p where p.id = ${projectId}::uuid`,
    );
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Не найдено');
    if (!r.rows[0].ok) throw new HttpError(403, 'forbidden', 'Нужна роль администратора');
    return a;
  }

  @Post('diff')
  @HttpCode(200)
  async diff(@Req() req: object, @Body() raw: unknown) {
    const b = parseBody(body, raw);
    await this.admin(req, b.projectId);
    const { ops, errors } = await diffOf(this.core.db, b.projectId, b.packPageId, b.replaceWith);
    return { ops, errors };
  }

  /** The diff is recomputed here; errors → 400. One transaction; the project row is locked and the diff re-checked inside. */
  @Post('apply')
  @HttpCode(200)
  async apply(@Req() req: object, @Body() raw: unknown) {
    const b = parseBody(body, raw);
    const a = await this.admin(req, b.projectId);
    const d = await diffOf(this.core.db, b.projectId, b.packPageId, b.replaceWith);
    if (d.errors.length) throw new HttpError(400, 'invalid_request', d.errors.join('; '), d.errors);
    const { muts, keyWrites } = await buildMutations(this.core.db, b.projectId, d, d.ops);
    try {
      await this.core.execute(a.userId, muts, {
        // system: automations do not react to the changes of the apply
        system: true,
        prepare: async (q) => {
          await q.execute(sql`select 1 from projects where id = ${b.projectId}::uuid for update`);
          const again = await diffOf(q, b.projectId, b.packPageId, b.replaceWith);
          if (JSON.stringify(again.ops) !== JSON.stringify(d.ops))
            throw new HttpError(409, 'conflict', 'Проект или пакет изменились, повторите diff');
        },
        after: async (q) => {
          await writeKeys(q, b.projectId, keyWrites);
          // the applied pack owns the keys, so it is the active one
          await q.execute(
            sql`update ai_harness_packs set active = (root_page_id = ${b.packPageId}::uuid), updated_at = now()
                where project_id = ${b.projectId}::uuid`,
          );
          // the events of harness.yml until the admin chooses them in the settings
          await q.execute(
            sql`update ai_harness_packs set events = ${JSON.stringify(d.pack.events)}::jsonb
                where project_id = ${b.projectId}::uuid and root_page_id = ${b.packPageId}::uuid and events is null`,
          );
        },
      });
    } catch (e) {
      throw asHttp(e);
    }
    return { ops: d.ops };
  }
}
