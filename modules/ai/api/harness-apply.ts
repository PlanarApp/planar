import { sql } from 'drizzle-orm';
import { HttpError, type CoreServices } from '@planar/server-kit';
import { buildMutations, diffOf, writeKeys } from './harness.js';
import { RETRO_QUEUE, type RetroData } from './retro.js';

export interface ApplyOpts {
  projectId: string;
  packPageId: string;
  /** status key to delete → key of the status its tasks move to */
  replaceWith?: Record<string, string>;
}

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

/** The diff of a pack stored in the project docs (REST and MCP share it). */
export async function diffPack(core: CoreServices, b: ApplyOpts) {
  const { ops, errors } = await diffOf(core.db, b.projectId, b.packPageId, b.replaceWith);
  return { ops, errors };
}

/** The diff is recomputed here; errors → 400. One transaction; the project row is locked and the diff re-checked inside. */
export async function applyPack(core: CoreServices, userId: string, b: ApplyOpts) {
  const d = await diffOf(core.db, b.projectId, b.packPageId, b.replaceWith);
  if (d.errors.length) throw new HttpError(400, 'invalid_request', d.errors.join('; '), d.errors);
  const { muts, keyWrites } = await buildMutations(core.db, b.projectId, d, d.ops);
  try {
    await core.execute(userId, muts, {
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
  // the AI is set up in the project: the task «harness-retro» (PLNRAPP-178)
  await core.enqueue(RETRO_QUEUE, {
    kind: 'init',
    projectId: b.projectId,
  } satisfies RetroData);
  return { ops: d.ops };
}
