import { Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AfterMutationCtx, JobDef, ModuleHookApi, MutationWrite } from '@planar/server-kit';
import type { BackendModuleManifest } from '@planar/shared';
import { uuidv7 } from '@planar/shared';
import { AI_BOT_LOGIN, AI_BOT_NAME, shared } from '../shared/index.js';
import { AiController } from './controller.js';
import { HarnessController } from './harness.controller.js';
import { PacksController } from './packs.controller.js';
import { EMAIL_QUEUE, handleEmail, replied, type EmailData } from './email.js';
import { AI_QUEUE, handle, keyOf, type AiRunData } from './run.js';

@Module({ controllers: [AiController, HarnessController, PacksController] })
class AiModule {}

export { resolveConnection, secretOf } from './connections.js';
export { generateStructured, checkConnection, costOf, type LlmConnection } from './llm.js';
export { MAX_RESTARTS } from '../shared/index.js';
export { parseInstructionPage } from './harness.js';
export {
  catalogTitle,
  packPages,
  parsePack,
  plainText,
  readCatalogPack,
  PACKS_ROOT_TITLE,
  unzipFiles,
  zipFiles,
} from './packs.js';
export { EMAIL_QUEUE, EMAILS_PER_HOUR, handleEmail, isYes } from './email.js';
export { AI_QUEUE, MAX_CHAIN, PLAN_HEADING, withPlan, type AiRunData } from './run.js';

const has = (r: Record<string, unknown> | null | undefined) =>
  ((r?.modules as string[] | undefined) ?? []).includes('ai');

/**
 * A project got the module: the bot «ИИ» (an active user `ai`, users.bot) exists and is a member of the
 * project's space with the role member, and of the project itself when its members are its own.
 */
async function ensureBot(writes: MutationWrite[], ctx: { now: string }, api: ModuleHookApi) {
  for (const w of writes) {
    if (w.entity !== 'projects' || !w.after || !has(w.after) || has(w.before)) continue;
    const bot = await api.ensureBotUser(AI_BOT_LOGIN, AI_BOT_NAME);
    const spaceId = w.after.spaceId as string;
    const projectId = w.after.id as string;
    const member = async (table: 'space_members' | 'project_members', col: string, id: string) =>
      (
        await api.q.execute(
          sql`select 1 from ${sql.identifier(table)} where ${sql.identifier(col)} = ${id}::uuid and user_id = ${bot}::uuid`,
        )
      ).rows.length > 0;
    const row = {
      spaceId,
      userId: bot,
      role: 'member' as const,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    if (!(await member('space_members', 'space_id', spaceId)))
      await api.sys.put('spaceMembers', { id: uuidv7(), ...row });
    if (
      w.after.membersMode === 'custom' &&
      !(await member('project_members', 'project_id', projectId))
    )
      await api.sys.put('projectMembers', { id: uuidv7(), projectId, ...row });
  }
}

type Row = Record<string, unknown>;
const one = async (api: ModuleHookApi, s: ReturnType<typeof sql>) =>
  (await api.q.execute(s)).rows[0] as Row | undefined;

/**
 * Assignments to the AI by a person (not the system, a rule or an AI run; the bot itself neither): a comment
 * assigned to the bot, `@ai` in a new comment (once, if it is not also assigned), a checklist item on the bot.
 * A new reply may answer a question of a waiting run.
 */
async function assignments(writes: MutationWrite[], ctx: AfterMutationCtx, api: ModuleHookApi) {
  if (ctx.system || ctx.origin) return;
  const mine = writes.filter(
    (w) => (w.entity === 'comments' || w.entity === 'checklistItems') && w.op === 'put' && w.after,
  );
  if (!mine.length) return;
  const bot = (await one(api, sql`select id from users where login = ${AI_BOT_LOGIN} and bot`))?.id;
  const me = await one(api, sql`select bot from users where id = ${ctx.userId}`);
  if (!bot || !me || me.bot) return;
  const enqueue = (d: AiRunData) =>
    api.enqueue(AI_QUEUE, d, { singletonKey: keyOf(d), upsert: true, startAfter: 5 });
  for (const { entity, before: b, after: a } of mine as {
    entity: string;
    before: Row | null;
    after: Row;
  }[]) {
    const taskId = a.taskId as string;
    if (entity === 'checklistItems') {
      if (a.assigneeId === bot && !a.done && b?.assigneeId !== bot)
        await enqueue({ kind: 'checklist', taskId });
      continue;
    }
    if (a.assigneeId === bot && !a.resolvedAt && b?.assigneeId !== bot)
      await enqueue({ kind: 'comment', taskId, itemId: a.id as string });
    else if (!b && ((a.mentions as string[] | undefined) ?? []).includes(bot as string))
      await enqueue({ kind: 'mention', taskId, itemId: a.id as string });
    if (!b && a.parentId && !(await replied(a, ctx, api))) await answered(a, ctx, api);
  }
}

/**
 * A reply answers a run waiting for people. Questions of a rule / checklist run: the reply of the question's
 * assignee closes it; all closed → the run is done and resumes. A thread of an assignment: the reply of the one
 * who assigned / asked resumes. waiting_human → done once: a second answer changes nothing.
 */
async function answered(c: Row, ctx: AfterMutationCtx, api: ModuleHookApi) {
  const runs = (
    await api.q.execute(
      sql`select id, kind, item_id as "itemId", question_comment_ids as qs from ai_runs
          where task_id = ${c.taskId as string} and state = 'waiting_human'`,
    )
  ).rows as { id: string; kind: string; itemId: string | null; qs: string[] }[];
  if (!runs.length) return;
  const get = (id: string) => api.sys.get('comments', id) as Promise<Row | undefined>;
  const parent = await get(c.parentId as string);
  if (!parent) return;
  for (const r of runs) {
    let done = false;
    if (r.qs.length) {
      if (
        !r.qs.includes(parent.id as string) ||
        parent.assigneeId !== c.authorId ||
        parent.resolvedAt
      )
        continue;
      await api.sys.patch('comments', parent.id as string, {
        resolvedAt: ctx.now,
        resolvedBy: c.authorId as string,
        updatedAt: ctx.now,
      });
      done = !(await one(
        api,
        sql`select 1 from comments where id = any(${`{${r.qs.join(',')}}`}::uuid[]) and resolved_at is null`,
      ));
    } else if (r.itemId) {
      let x: Row | undefined = parent;
      for (let i = 0; x && x.id !== r.itemId && i < 100; i++)
        x = x.parentId ? await get(x.parentId as string) : undefined;
      const item = x && (await get(r.itemId));
      done = !!item && c.authorId === (r.kind === 'comment' ? item.assigneeId : item.authorId);
    }
    if (!done) continue;
    const moved = await one(
      api,
      sql`update ai_runs set state = 'done', updated_at = now() where id = ${r.id} and state = 'waiting_human' returning id`,
    );
    if (moved) await api.enqueue(AI_QUEUE, { kind: 'resume', runId: r.id } satisfies AiRunData);
  }
}

async function afterMutation(writes: MutationWrite[], ctx: AfterMutationCtx, api: ModuleHookApi) {
  await ensureBot(writes, ctx, api);
  await assignments(writes, ctx, api);
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: AiModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs: [
    { queue: AI_QUEUE, retryLimit: 0, handler: handle } satisfies JobDef<AiRunData>,
    {
      queue: EMAIL_QUEUE,
      retryLimit: 0,
      handler: (d: EmailData, a) => handleEmail(d, a),
    } satisfies JobDef<EmailData>,
  ] as JobDef[],
};
