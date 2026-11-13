import { Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AfterMutationCtx, JobDef, ModuleHookApi, MutationWrite } from '@planar/server-kit';
import type { BackendModuleManifest } from '@planar/shared';
import { uuidv7 } from '@planar/shared';
import { AI_BOT_LOGIN, AI_BOT_NAME, shared } from '../shared/index.js';
import { AGENT_REAP_QUEUE, reap } from './agent.js';
import { AgentController } from './agent.controller.js';
import { AiController } from './controller.js';
import { HarnessController } from './harness.controller.js';
import { PacksController } from './packs.controller.js';
import { DocChatController } from './doc-chat.controller.js';
import { EMAIL_QUEUE, handleEmail, isYes, replied, textOf, type EmailData } from './email.js';
import type { JSONContent } from '@tiptap/core';
import { AI_QUEUE, handle, keyOf, type AiRunData } from './run.js';
import type { ChatPending } from './schema.js';
import {
  RETRO_QUEUE,
  RETRO_TICK_QUEUE,
  handleRetro,
  retroHook,
  retroTick,
  type RetroData,
} from './retro.js';

@Module({
  controllers: [
    AiController,
    HarnessController,
    PacksController,
    DocChatController,
    AgentController,
  ],
})
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
export {
  DISAGREE_RE,
  RETRO_QUEUE,
  RETRO_TICK_QUEUE,
  RETRO_TITLE,
  diffBlock,
  retroDecision,
  withAction,
  withPrompt,
  type RetroData,
} from './retro.js';

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
 * A new reply may answer a question of a waiting run; a reply to the bot's comment that answers nothing is
 * a request to the bot, as `@ai` (PLNRAPP-195).
 */
async function assignments(
  writes: MutationWrite[],
  ctx: AfterMutationCtx,
  api: ModuleHookApi,
  decisions: Set<string>,
) {
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
    // an answer on a harness-retro proposal (PLNRAPP-178): its decision, not a request to the bot
    if (decisions.has(a.id as string)) continue;
    let asked = true;
    if (a.assigneeId === bot && !a.resolvedAt && b?.assigneeId !== bot)
      await enqueue({ kind: 'comment', taskId, itemId: a.id as string });
    else if (!b && ((a.mentions as string[] | undefined) ?? []).includes(bot as string))
      await enqueue({ kind: 'mention', taskId, itemId: a.id as string });
    else asked = false;
    if (!b && a.parentId && !(await replied(a, ctx, api)) && !(await answered(a, ctx, api))) {
      const parent = (await api.sys.get('comments', a.parentId as string)) as Row | undefined;
      // not a request: the bot's question of a run (answered or not), a comment of the bot on another person
      if (
        !asked &&
        parent?.authorId === bot &&
        (!parent.assigneeId || parent.assigneeId === a.authorId) &&
        !(await one(
          api,
          sql`select 1 as x from ai_runs where task_id = ${taskId} and ${parent.id as string}::uuid = any(question_comment_ids)`,
        ))
      )
        await enqueue({ kind: 'mention', taskId, itemId: a.id as string });
    }
  }
}

/**
 * A reply answers a run waiting for people. Questions of a rule / checklist run: the reply of the question's
 * assignee closes it; all closed → the run is done and resumes. A thread of an assignment: the reply of the one
 * who assigned / asked resumes. waiting_human → done once: a second answer changes nothing.
 * Returns true if the reply was taken as an answer: closed a question or resumed a run.
 */
async function answered(c: Row, ctx: AfterMutationCtx, api: ModuleHookApi): Promise<boolean> {
  const runs = (
    await api.q.execute(
      sql`select id, kind, item_id as "itemId", question_comment_ids as qs from ai_runs
          where task_id = ${c.taskId as string} and state = 'waiting_human'
            and not exists (select 1 from ai_email_batches b where b.run_id = ai_runs.id and b.state = 'pending')`,
    )
  ).rows as { id: string; kind: string; itemId: string | null; qs: string[] }[];
  if (!runs.length) return false;
  const get = (id: string) => api.sys.get('comments', id) as Promise<Row | undefined>;
  const parent = await get(c.parentId as string);
  if (!parent) return false;
  let taken = false;
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
      taken = true;
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
    if (moved) {
      await api.enqueue(AI_QUEUE, { kind: 'resume', runId: r.id } satisfies AiRunData);
      taken = true;
    }
  }
  return taken;
}

/**
 * The initiator's answer in the thread of a chat run waiting for «да»: «да» → the planned calls run (job `confirm`,
 * as the initiator), anything else → the run is cancelled. Another person's message changes nothing.
 * Returns true if it was the «да» (the message is not a question for the bot).
 */
async function confirmed(m: Row, api: ModuleHookApi): Promise<boolean> {
  const waiting = (
    await api.q.execute(
      sql`select r.id, r.pending, im.author_id as "initiatorId" from ai_runs r
          join chat_messages im on im.id = r.item_id
          where r.kind = 'chat' and r.state = 'waiting_human' and r.pending is not null
            and r.channel_id = ${m.channelId as string}`,
    )
  ).rows as { id: string; pending: ChatPending; initiatorId: string }[];
  const mine = waiting.find(
    (r) => r.initiatorId === m.authorId && r.pending.parentId === ((m.parentId as string) ?? null),
  );
  if (!mine) return false;
  const yes = isYes(textOf(m.body as JSONContent));
  const taken = await one(
    api,
    sql`update ai_runs set state = ${yes ? 'running' : 'cancelled'}, updated_at = now()
        where id = ${mine.id} and state = 'waiting_human' returning id`,
  );
  if (taken && yes)
    await api.enqueue(AI_QUEUE, { kind: 'confirm', runId: mine.id } satisfies AiRunData);
  return !!taken && yes;
}

/**
 * A person's new chat message the bot answers (D5): in a dialog of two (the person and the bot) — always;
 * elsewhere only a reply in the thread of a bot's message or `@ai` in the message. Messages of bots never start a run.
 */
async function chatMessages(writes: MutationWrite[], api: ModuleHookApi) {
  const mine = writes.filter((w) => w.entity === 'chatMessages' && !w.before && w.after);
  if (!mine.length) return;
  const bot = (await one(api, sql`select id from users where login = ${AI_BOT_LOGIN} and bot`))?.id;
  if (!bot) return;
  for (const { after: m } of mine as { after: Row }[]) {
    if (m.deletedAt || m.authorId === bot) continue;
    const who = await one(api, sql`select bot from users where id = ${m.authorId as string}`);
    if (!who || who.bot) continue;
    if (await confirmed(m, api)) continue;
    const members = (
      await api.q.execute(
        sql`select user_id as u from chat_members where channel_id = ${m.channelId as string}`,
      )
    ).rows.map((r) => r.u);
    const direct =
      (await one(
        api,
        sql`select 1 as x from chat_channels where id = ${m.channelId as string} and kind = 'dm'`,
      )) &&
      members.length === 2 &&
      members.includes(bot);
    let asked = direct || ((m.mentions as string[] | undefined) ?? []).includes(bot as string);
    if (!asked && m.parentId)
      asked = !!(await one(
        api,
        sql`select 1 as x from chat_messages where id = ${m.parentId as string} and author_id = ${bot as string}`,
      ));
    if (!asked) continue;
    const d: AiRunData = {
      kind: 'chat',
      messageId: m.id as string,
      channelId: m.channelId as string,
      initiatorId: m.authorId as string,
    };
    await api.enqueue(AI_QUEUE, d, { singletonKey: keyOf(d), upsert: true, startAfter: 2 });
  }
}

async function afterMutation(writes: MutationWrite[], ctx: AfterMutationCtx, api: ModuleHookApi) {
  await ensureBot(writes, ctx, api);
  await assignments(writes, ctx, api, await retroHook(writes, ctx, api));
  await chatMessages(writes, api);
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: AiModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs: [
    { queue: AI_QUEUE, retryLimit: 0, handler: handle } satisfies JobDef<AiRunData>,
    { queue: AGENT_REAP_QUEUE, cron: '* * * * *', retryLimit: 0, handler: reap },
    { queue: RETRO_QUEUE, retryLimit: 0, handler: handleRetro } satisfies JobDef<RetroData>,
    { queue: RETRO_TICK_QUEUE, cron: '17 * * * *', retryLimit: 0, handler: retroTick },
    {
      queue: EMAIL_QUEUE,
      retryLimit: 0,
      handler: (d: EmailData, a) => handleEmail(d, a),
    } satisfies JobDef<EmailData>,
  ] as JobDef[],
};
