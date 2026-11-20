import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { parse as parseYaml, parseDocument } from 'yaml';
import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import type { AfterMutationCtx, JobApi, ModuleHookApi, MutationWrite, Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { AI_ACTION_KEY_RE, AI_BOT_LOGIN, lineDiff, parseHarnessYaml } from '../shared/index.js';
import { resolveConnection, secretOf } from './connections.js';
import { textOf } from './email.js';
import { harnessBlock, loadPack, parseInstructionPage } from './harness.js';
import { generateStructured } from './llm.js';
import { instructionBody } from './packs.js';
import { tracked, type Tracker } from './monitor.js';
import { aiEnabled, asDoc, blocked, md, withMention } from './run.js';
import type { RetroNewAction } from './schema.js';

/**
 * harness-retro (PLNRAPP-178): the project's harness learns from its runs, as `dpcli feedback` + `harness-retro`.
 * The task «harness-retro» collects subtasks — frictions of runs («что мешало»), results of assignments and chat,
 * the admins' answers to the bot («не так», a manual rollback of the status after a run). Every N frictions or
 * every N days the retro clusters them and proposes an edit of an instruction of the active pack: a subtask in
 * «Уточнение» on the admin with the diff in a comment; the admin's answer in its thread decides — apply, close, redo.
 * An obvious edit goes in at once (the admin gets the diff); an edit of an instruction changed meanwhile is carried
 * over onto the current text; weekly (or by hand) a pass over the whole pack shortens and dedupes it. The retro
 * edits only the pack's pages in the tracker — never the repository.
 */

export const RETRO_QUEUE = 'ai.retro';
export const RETRO_TICK_QUEUE = 'ai.retro.tick';
export const RETRO_TITLE = 'harness-retro';
/** proposals of one retro at most */
export const RETRO_MAX_PROPOSALS = 3;

export type RetroData =
  /** the AI was set up in the project (the pack applied): the task «harness-retro» exists */
  | { kind: 'init'; projectId: string }
  /** cluster the open subtasks into proposals */
  | {
      kind: 'run';
      projectId: string;
      /** PLNRAPP-500: for the monitor; absent — by frictions (event) */
      trigger?: 'cron' | 'manual';
      userId?: string | null;
    }
  /** an admin's answer to the bot: a subtask */
  | { kind: 'feedback'; projectId: string; taskId: string; title: string; text: string }
  /** shorten, dedupe and make consistent the pack's instructions (weekly by the tick, or by hand) */
  | {
      kind: 'optimize';
      projectId: string;
      trigger?: 'cron' | 'manual';
      userId?: string | null;
    }
  /** the admin answered in a proposal's subtask */
  | { kind: 'decide'; proposalId: string; replyId: string };

export interface RetroSettings {
  enabled: boolean;
  everyFrictions: number;
  everyDays: number;
}
export const RETRO_DEFAULTS: RetroSettings = { enabled: true, everyFrictions: 5, everyDays: 7 };

type Row = Record<string, unknown>;
type Doc = { type: 'doc'; content: JSONContent[] };
type Mut = { name: string; args: Record<string, unknown> };
type Exec = Pick<Q, 'execute'>;
const rows = async (q: Exec, s: ReturnType<typeof sql>) => (await q.execute(s)).rows as Row[];
const one = async (q: Exec, s: ReturnType<typeof sql>) => (await rows(q, s))[0];
const cut = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const quote = (s: string) =>
  (s.trim() || '—')
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The project's settings and state; no row — the defaults (on). */
export async function retroOf(q: Exec, projectId: string) {
  const r = await one(
    q,
    sql`select enabled, every_frictions as "everyFrictions", every_days as "everyDays", task_id as "taskId",
        frictions, last_run_at as "lastRunAt" from ai_retro where project_id = ${projectId}::uuid`,
  );
  return {
    ...RETRO_DEFAULTS,
    taskId: null as string | null,
    frictions: 0,
    lastRunAt: null as string | null,
    ...(r as Partial<RetroSettings & { taskId: string | null; frictions: number }> | undefined),
  };
}

/**
 * The retro works in the project: the switch is on (no row — on) and the AI is set up — an active harness pack
 * with its pages (the retro edits them; without a pack there is nothing to improve).
 */
export async function retroOn(q: Exec, projectId: string) {
  if (!(await retroOf(q, projectId)).enabled) return false;
  return !!(await one(
    q,
    sql`select 1 as x from ai_harness_packs h join projects p on p.id = h.project_id
        where h.project_id = ${projectId}::uuid and h.active and h.root_page_id is not null and 'ai' = any(p.modules)`,
  ));
}

const botId = async (q: Exec) =>
  (await one(q, sql`select id from users where login = ${AI_BOT_LOGIN} and bot`))?.id as
    string | undefined;

const isAdmin = async (q: Exec, userId: string, projectId: string) =>
  !!(await one(
    q,
    sql`select 1 as x from users u where u.id = ${userId}::uuid and not u.bot
        and project_role(u.id, ${projectId}::uuid) = 'admin'`,
  ));

/** The admin a proposal goes to: the project lead if an admin, else the first admin of the space. */
async function adminOf(q: Exec, projectId: string) {
  return (await one(
    q,
    sql`select u.id, u.login from projects p
        join space_members m on m.space_id = p.space_id
        join users u on u.id = m.user_id
        where p.id = ${projectId}::uuid and not u.bot and u.deactivated_at is null
          and project_role(u.id, p.id) = 'admin'
        order by (u.id = p.lead_id) desc nulls last, m.created_at, u.id limit 1`,
  )) as { id: string; login: string } | undefined;
}

/** The first status of a category group, by rank. */
async function statusOf(q: Exec, projectId: string, order: string[]) {
  const cases = sql.join(
    order.map((c, i) => sql`when ${c} then ${sql.raw(String(i))}`),
    sql` `,
  );
  return (
    await one(
      q,
      sql`select id from statuses where project_id = ${projectId}::uuid
          order by case category ${cases} else ${sql.raw(String(order.length))} end, rank collate "C" limit 1`,
    )
  )?.id as string;
}

/** «Уточнение»: the question status of the project's actions, else a status named so, else the first todo. */
async function clarifyOf(q: Exec, projectId: string) {
  const a = await one(
    q,
    sql`select question_status_id as id from ai_actions where project_id = ${projectId}::uuid
        and question_status_id is not null order by created_at limit 1`,
  );
  if (a) return a.id as string;
  const s = await one(
    q,
    sql`select id from statuses where project_id = ${projectId}::uuid and lower(name) in ('уточнение', 'clarify')
        order by rank collate "C" limit 1`,
  );
  return (s?.id as string | undefined) ?? (await statusOf(q, projectId, ['todo', 'backlog']));
}

const lastRank = async (q: Exec, projectId: string, parentId: string | null) =>
  ((
    await one(
      q,
      sql`select max(rank collate "C") as r from tasks where project_id = ${projectId}::uuid
          and ${parentId ? sql`parent_id = ${parentId}::uuid` : sql`parent_id is null`}`,
    )
  )?.r as string | null) ?? null;

const RETRO_DESCRIPTION = `Задача harness-retro: сюда ИИ собирает подзадачи — трения прогонов («что мешало»), итоги поручений и чата, ответы администраторов («не так», ручной откат статуса после прогона).

Раз в N трений или раз в N дней ИИ группирует их и правит инструкции harness-пакета: очевидную правку применяет сразу и присылает diff, остальные предлагает подзадачей в «Уточнении» на администратора. Ответ в подзадаче: «применить», «закрыть» или что переделать. Раз в неделю ИИ сокращает инструкции, убирает повторы и противоречия — так же.

Выключатель и частота — Настройки → ИИ → harness-retro.`;

/**
 * The task «harness-retro» of the project: created if missing (or deleted); null — the retro is off or the project
 * has no AI. The row of ai_retro is locked: two runs at once make one task.
 */
export async function ensureRetroTask(api: JobApi, projectId: string): Promise<string | null> {
  if (!(await retroOn(api.db, projectId))) return null;
  const s = await retroOf(api.db, projectId);
  const alive = (q: Exec, id: string | null) =>
    id
      ? one(q, sql`select 1 as x from tasks where id = ${id}::uuid and archived_at is null`)
      : undefined;
  if (await alive(api.db, s.taskId)) return s.taskId;
  const bot = await botId(api.db);
  if (!bot) return null;
  const id = uuidv7();
  let made = false;
  await api.execute(
    bot,
    [
      {
        name: 'task.create',
        args: {
          id,
          projectId,
          statusId: await statusOf(api.db, projectId, ['backlog', 'todo']),
          title: RETRO_TITLE,
          rank: generateKeyBetween(await lastRank(api.db, projectId, null), null),
          description: asDoc(RETRO_DESCRIPTION),
          // PLNRAPP-679: on the AI, not the project's default assignee: the bot's own bookkeeping
          assignees: [{ id: uuidv7(), userId: bot }],
        },
      },
    ],
    {
      // automations do not react: the bot's own bookkeeping
      system: true,
      prepare: async (q) => {
        await q.execute(
          sql`insert into ai_retro (project_id) values (${projectId}::uuid) on conflict (project_id) do nothing`,
        );
        const r = await one(
          q,
          sql`select task_id as "taskId" from ai_retro where project_id = ${projectId}::uuid for update`,
        );
        if (await alive(q, (r?.taskId as string | null) ?? null)) return false;
      },
      after: async (q) => {
        await q.execute(
          sql`update ai_retro set task_id = ${id}::uuid, updated_at = now() where project_id = ${projectId}::uuid`,
        );
        made = true;
      },
    },
  );
  return made ? id : (await retroOf(api.db, projectId)).taskId;
}

/** A subtask of «harness-retro» in the first backlog / todo status; null — the retro is off. */
async function addItem(api: JobApi, projectId: string, title: string, text: string) {
  const parentId = await ensureRetroTask(api, projectId);
  const bot = await botId(api.db);
  if (!parentId || !bot) return null;
  const id = uuidv7();
  await api.execute(
    bot,
    [
      {
        name: 'task.create',
        args: {
          id,
          projectId,
          parentId,
          statusId: await statusOf(api.db, projectId, ['backlog', 'todo']),
          title: cut(title, 200),
          rank: generateKeyBetween(await lastRank(api.db, projectId, parentId), null),
          description: asDoc(text),
          assignees: [{ id: uuidv7(), userId: bot }],
        },
      },
    ],
    { system: true },
  );
  return id;
}

/** The task belongs to the retro itself (the task or its subtasks): no items about it. */
async function ownTree(q: Exec, projectId: string, task: { id: string; parentId: string | null }) {
  const { taskId } = await retroOf(q, projectId);
  return !!taskId && (task.id === taskId || task.parentId === taskId);
}

/**
 * PLNRAPP-679: a pass of the task control — the task «harness-retro» back in the first backlog status on the AI alone,
 * its open items (not proposals: those are the admin's) on the AI alone. AI actions never run on this tree.
 */
export async function retroPass(api: JobApi, t: Tracker, projectId: string | null = null) {
  const bot = await botId(api.db);
  if (!bot) return;
  const found = (await rows(
    api.db,
    sql`select r.project_id as "projectId", r.task_id as "taskId", p.key || '-' || t.number as key
        from ai_retro r join tasks t on t.id = r.task_id and t.archived_at is null
          join projects p on p.id = r.project_id
        ${projectId ? sql`where r.project_id = ${projectId}::uuid` : sql``}`,
  )) as { projectId: string; taskId: string; key: string }[];
  for (const f of found) {
    if (!(await retroOn(api.db, f.projectId))) continue;
    await t.check();
    const backlog = await statusOf(api.db, f.projectId, ['backlog', 'todo']);
    const tree = (await rows(
      api.db,
      sql`select t.id, t.status_id as "statusId", t.id = ${f.taskId}::uuid as root,
            coalesce(array_agg(a.user_id) filter (where a.user_id is not null), '{}') as users
          from tasks t join statuses st on st.id = t.status_id
            left join task_assignees a on a.task_id = t.id
          where t.id = ${f.taskId}::uuid or (t.parent_id = ${f.taskId}::uuid and t.archived_at is null
            and st.category not in ('done', 'cancelled')
            and not exists (select 1 from ai_retro_proposals x where x.task_id = t.id))
          group by t.id`,
    )) as { id: string; statusId: string; root: boolean; users: string[] }[];
    const muts: Mut[] = [];
    let moved = false;
    for (const x of tree) {
      if (x.root && backlog && x.statusId !== backlog) {
        muts.push({ name: 'task.update', args: { id: x.id, statusId: backlog } });
        moved = true;
      }
      if (!x.users.includes(bot))
        muts.push({ name: 'task.assign', args: { id: uuidv7(), taskId: x.id, userId: bot } });
      for (const u of x.users)
        if (u !== bot) muts.push({ name: 'task.unassign', args: { taskId: x.id, userId: u } });
    }
    if (!muts.length) continue;
    // automations do not react: the bot's own bookkeeping
    await api.execute(bot, muts, { system: true });
    t.count();
    await t.step(
      `сверка: ${f.key} — сборщик harness-retro${moved ? ' возвращён в бэклог,' : ''} задача и трения на ИИ`,
      { projectId: f.projectId, taskId: f.taskId, level: 'action' },
    );
  }
}

const KIND_NAMES: Record<string, string> = {
  action: 'действие',
  comment: 'поручение',
  mention: 'упоминание',
  checklist: 'пункт чек-листа',
};

/**
 * After a run applied its result: a friction («что мешало») → a subtask (every `everyFrictions` of them start
 * the retro); an assignment (comment, @ai, checklist item) → a subtask with the request and the bot's answer.
 */
export async function collectRun(
  api: JobApi,
  run: {
    id: string;
    kind: string;
    task: { id: string; projectId: string; parentId: string | null; key: string; title: string };
    action?: { name: string };
    item?: Row;
  },
  r: { verdict: string; comment: string; friction?: string | null },
) {
  const { task } = run;
  if (!(await retroOn(api.db, task.projectId)) || (await ownTree(api.db, task.projectId, task)))
    return;
  const what = run.action?.name ?? KIND_NAMES[run.kind] ?? run.kind;
  const where = `Задача ${task.key} «${task.title}», прогон ${run.id} (${what}), итог: ${r.verdict}.`;
  const friction = r.friction?.trim();
  if (friction) {
    await addItem(
      api,
      task.projectId,
      `Трение: ${task.key} · ${what} · ${friction}`,
      `**Что мешало:**\n\n${quote(friction)}\n\n${where}`,
    );
    const n = await one(
      api.db,
      sql`update ai_retro set frictions = frictions + 1, updated_at = now()
          where project_id = ${task.projectId}::uuid returning frictions, every_frictions as "every"`,
    );
    if (n && (n.frictions as number) >= (n.every as number))
      await api.enqueue(
        RETRO_QUEUE,
        { kind: 'run', projectId: task.projectId } satisfies RetroData,
        {
          singletonKey: `retro:${task.projectId}`,
          upsert: true,
          startAfter: 60,
        },
      );
  }
  if (run.kind !== 'action' && run.item) {
    const ask =
      run.kind === 'checklist' ? String(run.item.text ?? '') : md(run.item.body as JSONContent);
    await addItem(
      api,
      task.projectId,
      `Поручение: ${task.key} · ${ask}`,
      `**Поручение** (${what}):\n\n${quote(ask)}\n\n**Ответ ИИ** (${r.verdict}):\n\n${quote(r.comment)}\n\n${where}`,
    );
  }
}

/** A chat run answered in a project channel: a subtask with the message and the answer. */
export async function collectChat(
  api: JobApi,
  projectId: string | null,
  message: unknown,
  answer: string,
) {
  if (!projectId || !(await retroOn(api.db, projectId))) return;
  const ask = md(message as JSONContent);
  await addItem(
    api,
    projectId,
    `Чат: ${ask}`,
    `**Сообщение в чате:**\n\n${quote(ask)}\n\n**Ответ ИИ:**\n\n${quote(answer)}`,
  );
}

/** «не так» in an answer to the bot: a disagreement of the admin. */
export const DISAGREE_RE = /(^|[^\p{L}])не\s+так([^\p{L}]|$)/iu;

/**
 * afterMutation: an admin's answer to the automation → a feedback subtask (job); an answer in the thread of a
 * proposal's subtask (a reply at any depth, @ai) → the retro answers it (job). Returns ids of comments taken as decisions: they are not requests to the bot.
 */
export async function retroHook(
  writes: MutationWrite[],
  ctx: AfterMutationCtx,
  api: ModuleHookApi,
): Promise<Set<string>> {
  const taken = new Set<string>();
  if (ctx.system || ctx.origin) return taken;
  const mine = writes.filter(
    (w) =>
      (w.entity === 'comments' &&
        !w.before &&
        (w.after?.parentId || (w.after?.mentions as string[] | undefined)?.length)) ||
      (w.entity === 'tasks' && w.before && w.after && w.before.statusId !== w.after.statusId),
  );
  if (!mine.length) return taken;
  const me = await one(api.q, sql`select bot from users where id = ${ctx.userId}::uuid`);
  if (!me || me.bot) return taken;
  const feedback = (d: Extract<RetroData, { kind: 'feedback' }>) =>
    api.enqueue(RETRO_QUEUE, d satisfies RetroData);
  for (const w of mine as { entity: string; before: Row | null; after: Row }[]) {
    const a = w.after;
    const taskId = (w.entity === 'tasks' ? a.id : a.taskId) as string;
    const t = await one(
      api.q,
      sql`select t.project_id as "projectId", p.key || '-' || coalesce(t.number::text, '?') as key, t.title,
          'ai' = any(p.modules) as ai from tasks t join projects p on p.id = t.project_id where t.id = ${taskId}::uuid`,
    );
    if (!t?.ai) continue;
    const projectId = t.projectId as string;
    if (w.entity === 'comments') {
      // any reply or @ai in a proposal's subtask is about the proposal: the retro answers it, not a run
      // of the event «mention» (it does not see the pack in the tracker and may go to the repository)
      const p = await one(
        api.q,
        sql`select id, assignee_id as "assigneeId" from ai_retro_proposals
            where task_id = ${taskId}::uuid order by created_at desc limit 1`,
      );
      const mentions = (a.mentions as string[] | undefined) ?? [];
      if (p && (a.parentId || mentions.includes((await botId(api.q)) ?? ''))) {
        taken.add(a.id as string);
        if (p.assigneeId === ctx.userId || (await isAdmin(api.q, ctx.userId, projectId)))
          await api.enqueue(RETRO_QUEUE, {
            kind: 'decide',
            proposalId: p.id as string,
            replyId: a.id as string,
          } satisfies RetroData);
        continue;
      }
      const text = textOf(a.body as JSONContent);
      if (!a.parentId || !DISAGREE_RE.test(text) || !(await isAdmin(api.q, ctx.userId, projectId)))
        continue;
      const parent = await one(
        api.q,
        sql`select c.body from comments c join users u on u.id = c.author_id
            where c.id = ${a.parentId as string}::uuid and u.bot`,
      );
      if (!parent) continue;
      await feedback({
        kind: 'feedback',
        projectId,
        taskId,
        title: `Ответ админа: ${t.key as string} · ${text}`,
        text: `**Комментарий ИИ** в задаче ${t.key as string} «${t.title as string}»:\n\n${quote(md(parent.body as JSONContent))}\n\n**Ответ администратора:**\n\n${quote(md(a.body as JSONContent))}`,
      });
    } else {
      if (!(await isAdmin(api.q, ctx.userId, projectId))) continue;
      // the bot's last move of the status (a run), reverted by hand: back to the status it moved from
      const last = await one(
        api.q,
        sql`select a.changes -> 'statusId' as s from activity a join users u on u.id = a.actor_id
            where a.task_id = ${taskId}::uuid and a.kind = 'updated' and a.changes ? 'statusId'
              and u.login = ${AI_BOT_LOGIN} and u.bot and a.created_at > now() - interval '7 days'
            order by a.created_at desc limit 1`,
      );
      const [from, to] = (last?.s as [string, string] | undefined) ?? [];
      if (!from || !to || to !== w.before!.statusId || from !== a.statusId) continue;
      const names = await rows(
        api.q,
        sql`select id, name from statuses where id in (${from}::uuid, ${to}::uuid)`,
      );
      const name = (id: string) => (names.find((n) => n.id === id)?.name as string) ?? '?';
      await feedback({
        kind: 'feedback',
        projectId,
        taskId,
        title: `Откат статуса: ${t.key as string} · ${name(to)} → ${name(from)}`,
        text: `Прогон ИИ перевёл задачу ${t.key as string} «${t.title as string}» из «${name(from)}» в «${name(to)}», администратор вернул её в «${name(from)}».`,
      });
    }
  }
  return taken;
}

// ---------- the retro ----------

const proposalSchema = z.object({
  title: z.string().min(1).max(200),
  why: z.string().max(4000),
  /** keys of the subtasks the edit covers */
  items: z.array(z.string()).max(50),
  /** an action of the pack — its instruction is edited; a new key — a new action */
  action: z.string().min(1).max(50),
  newAction: z
    .object({
      name: z.string().min(1).max(100),
      description: z.string().max(2000).nullable(),
      /** YAML of one item of `rules` of harness.yml */
      rule: z.string().max(4000).nullable(),
    })
    .nullable(),
  /** the whole new text of the instruction (after its parameters table) */
  prompt: z.string().min(1).max(30_000),
  /** an obviously useful edit of an existing instruction: applied at once, the admin gets the diff */
  auto: z.boolean(),
});
const retroSchema = z.object({ proposals: z.array(proposalSchema).max(RETRO_MAX_PROPOSALS) });
const redoSchema = z.object({
  title: z.string().min(1).max(200),
  why: z.string().max(4000),
  prompt: z.string().min(1).max(30_000),
  rule: z.string().max(4000).nullable(),
});
type Proposal = z.infer<typeof proposalSchema>;

/** Where the retro works: the pack's pages in the tracker, never the repository. */
const SCOPE_RULE =
  'Ты правишь только инструкции harness-пакета этого проекта — страницы в трекере, их текущая версия дана ниже. Репозиторий, коммиты, ветки и MR тебя не касаются.';
const AUTO_RULE =
  '- auto — true, если правка существующей инструкции очевидно полезна и не меняет порядок работы по существу (уточнение, исправление противоречия или ошибки, сокращение без потери смысла, удаление дубля): она применится сразу, администратор получит diff. Новое действие, новое правило, смена порядка работы — auto: false, решает администратор.';

export const RETRO_PROMPT = `Ты — harness-retro трекера задач Planar: улучшаешь инструкции ИИ-действий проекта (harness-пакет) по накопленным подзадачам — трениям прогонов («что мешало»), итогам поручений и чата, ответам администраторов («не так», ручной откат статуса после прогона). ${SCOPE_RULE}
Сгруппируй подзадачи по причине. На каждую повторяющуюся причину (две подзадачи и больше или одно явное замечание администратора) — одно предложение, не больше ${RETRO_MAX_PROPOSALS}, полезные первыми:
- action — ключ действия из списка; prompt — полный новый текст его инструкции (markdown). Правка минимальная: добавь или уточни раздел, остальной текст сохрани дословно.
- Повторяющиеся поручения одного вида превращай в раздел инструкции события («Поручение» — comment, mention, checklist; «Чат» — chat) или в отдельное действие с правилом: action — новый ключ (латиница, a-z0-9_-), newAction — {name, description, rule}, rule — YAML одного правила harness.yml (name, description, trigger, filter, actions: [{type: ai_run, action: <ключ>}]) или null; prompt — инструкция нового действия; иначе newAction — null.
- title — суть правки; why — какие подзадачи и почему, коротко; items — ключи подзадач, которые правка закрывает.
${AUTO_RULE}
Опирайся только на подзадачи, ничего не выдумывай. Нечего предлагать — proposals: [].`;

/** The periodic (and manual) pass over the whole pack: shorter, no duplicates, consistent. */
export const OPTIMIZE_PROMPT = `Ты — harness-retro трекера задач Planar: оптимизируешь инструкции ИИ-действий проекта (harness-пакет). ${SCOPE_RULE}
Найди повторы внутри инструкции и между инструкциями, противоречия между инструкциями и с harness.yml, устаревшее и лишнее, места, которые можно сказать короче без потери смысла. На каждую находку — одно предложение, не больше ${RETRO_MAX_PROPOSALS}, полезные первыми:
- action — ключ действия из списка; prompt — полный новый текст его инструкции (markdown), остальной текст сохрани дословно; newAction — null; items — [].
- title — суть правки; why — что и почему, коротко.
${AUTO_RULE}
Новых правил не выдумывай, смысл не меняй. Инструкции в порядке — proposals: [].`;

const REDO_PROMPT = `Ты — harness-retro трекера задач Planar. Администратор ответил на правку инструкции ИИ-действия. ${SCOPE_RULE}
Переделай правку по ответу: prompt — полный новый текст инструкции от её текущей версии (markdown; правка минимальная, остальной текст сохрани дословно), title — суть правки, why — что изменено, rule — YAML правила harness.yml для нового действия (как было или исправленное) или null. Ответ — вопрос: ответь в why, prompt оставь как в правке. Просят объединить с другой правкой или вернуть как было — сделай это в prompt.`;

const REBASE_PROMPT = `Ты — harness-retro трекера задач Planar. ${SCOPE_RULE}
Правка подготовлена к прежней версии инструкции, а инструкция с тех пор изменилась. Перенеси суть правки на текущую версию: prompt — полный новый текст (markdown), всё из текущей версии сохрани дословно, кроме мест, которые меняет правка; правка в текущей версии уже есть — верни текущую без изменений.`;
const rebaseSchema = z.object({ prompt: z.string().min(1).max(30_000) });

interface ActivePack {
  rootId: string;
  yml: string;
  actions: string[];
  instructions: Record<string, { name: string; prompt: string }>;
  pageIds: Record<string, string>;
  events: Record<string, string>;
}

/** The active pack of the project; null — none (or broken): the retro has nothing to edit. */
async function activePack(q: Exec, projectId: string): Promise<ActivePack | null> {
  const p = await one(
    q,
    sql`select root_page_id as "rootId", events from ai_harness_packs
        where project_id = ${projectId}::uuid and active and root_page_id is not null`,
  );
  if (!p) return null;
  try {
    const l = await loadPack(q as never, projectId, p.rootId as string);
    const root = await one(q, sql`select body from docs_pages where id = ${p.rootId as string}`);
    const block = harnessBlock(((root?.body as Doc | undefined)?.content ?? []) as never);
    return {
      rootId: p.rootId as string,
      yml: block ? textOf(block as JSONContent) : '',
      actions: l.pack.actions,
      instructions: l.instructions,
      pageIds: l.pageIds,
      events: (p.events as Record<string, string> | null) ?? l.pack.events,
    };
  } catch {
    return null;
  }
}

/** harness.yml with a new action (and its rule); throws when the pack does not parse after it. */
export function withAction(yml: string, key: string, rule: string | null): string {
  const doc = parseDocument(yml);
  if (!doc.has('actions')) doc.set('actions', doc.createNode([]));
  doc.addIn(['actions'], key);
  if (rule?.trim()) {
    const r = parseYaml(rule) as unknown;
    const item = Array.isArray(r) ? (r[0] as unknown) : r;
    if (!item || typeof item !== 'object') throw new Error('правило: не YAML-объект');
    if (!doc.has('rules')) doc.set('rules', doc.createNode([]));
    doc.addIn(['rules'], doc.createNode(item));
  }
  const out = doc.toString();
  parseHarnessYaml(out);
  return out;
}

/** The diff for a comment: changed lines with two lines of context, the rest folded. */
export function diffBlock(a: string, b: string): string {
  const d = lineDiff(a.trim(), b.trim());
  const near = (i: number) => d.slice(Math.max(0, i - 2), i + 3).some((x) => x.type !== 'same');
  const out: string[] = [];
  let folded = false;
  d.forEach((x, i) => {
    if (x.type === 'same' && !near(i)) {
      if (!folded) out.push('…');
      folded = true;
      return;
    }
    folded = false;
    out.push(`${x.type === 'add' ? '+' : x.type === 'del' ? '-' : ' '} ${x.text}`);
  });
  return `\`\`\`\`diff\n${out.join('\n')}\n\`\`\`\``;
}

const ANSWER_HINT =
  'Ответьте в треде этого комментария: «применить» — правка запишется в harness-пакет; «закрыть» — отклонить; любой другой ответ — что переделать.';
const AUTO_HINT =
  'Очевидная правка — применяется сразу. Не согласны — ответьте в треде, что изменить или «верни как было».';

function proposalComment(
  name: string,
  key: string,
  base: string,
  prompt: string,
  ymlDiff: string | null,
  auto = false,
) {
  return [
    ymlDiff
      ? `Новое действие «${name}» (\`${key}\`): страница инструкции и harness.yml.`
      : `Правка инструкции «${name}» (\`${key}\`).`,
    diffBlock(base, prompt),
    ...(ymlDiff ? ['harness.yml:', ymlDiff] : []),
    auto ? AUTO_HINT : ANSWER_HINT,
  ].join('\n\n');
}

/**
 * An LLM call of the retro as a run of the task (kind retro): its tokens and cost count in the limits. `signal` —
 * the engine pass's: a manual pass aborting it cuts the request (the run — cancelled, null).
 */
async function llmRun<S extends z.ZodType>(
  api: JobApi,
  projectId: string,
  taskId: string,
  call: { schema: S; system: string; prompt: string; signal?: AbortSignal },
): Promise<{ runId: string; object: z.output<S> } | null> {
  if (await blocked(api.db, projectId)) return null;
  const conn = await resolveConnection(api.db, projectId);
  if (!conn) return null;
  const runId = uuidv7();
  await api.db.execute(
    sql`insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth)
        values (${runId}, ${taskId}, ${projectId}, 'retro', 'running', ${runId}, 0)`,
  );
  try {
    const { signal, ...c } = call;
    const { object, usage } = await generateStructured(secretOf(conn), {
      ...c,
      abortSignal: signal,
    });
    await api.db.execute(
      sql`update ai_runs set input_tokens = ${usage.inputTokens}, output_tokens = ${usage.outputTokens},
          cost = ${usage.cost}, updated_at = now() where id = ${runId}`,
    );
    return { runId, object };
  } catch (e) {
    if (call.signal?.aborted) {
      await endRun(api.db, runId, 'cancelled', 'прервано ручным запуском');
      return null;
    }
    // the provider's own text is dropped: it may quote the key
    await endRun(api.db, runId, 'failed', `провайдер: ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}

const endRun = (q: Exec, id: string, state: string, log: string) =>
  q.execute(
    sql`update ai_runs set state = ${state}, log = log || ${log ? `${log}\n` : ''}, updated_at = now() where id = ${id}`,
  );

/** The pack's instructions for a prompt of the retro. */
const packText = (pack: ActivePack) =>
  [
    '# Инструкции активного harness-пакета',
    `События без правила → действие: ${
      Object.entries(pack.events)
        .map(([e, a]) => `${e} → ${a}`)
        .join(', ') || '—'
    }.`,
    ...pack.actions.map((k) => {
      const i = pack.instructions[k];
      return `\n## Действие \`${k}\` — «${i?.name ?? k}»\n${i?.prompt ?? '—'}`;
    }),
  ].join('\n');

/**
 * Throws EngineAborted when a manual pass replaced this one (the AI run of the answer, if any — cancelled): an
 * aborted pass applies nothing of the AI's answer.
 */
async function abortedRun(api: JobApi, t: Tracker, r: { runId: string } | null) {
  try {
    await t.check();
  } catch (e) {
    if (r) await endRun(api.db, r.runId, 'cancelled', 'прервано ручным запуском');
    throw e;
  }
}

/** One retro: open items → proposals (subtasks on the admin with the diff). */
async function runRetro(projectId: string, api: JobApi, t: Tracker) {
  if (!(await aiEnabled(api.db))) return void (await t.step('ИИ выключен — пропуск'));
  const s = await retroOf(api.db, projectId);
  if (!s.enabled || !s.taskId)
    return void (await t.step('harness-retro в проекте выключено или нет задачи — пропуск'));
  const retroTask = await one(
    api.db,
    sql`select id from tasks where id = ${s.taskId}::uuid and archived_at is null`,
  );
  const bot = await botId(api.db);
  if (!retroTask || !bot)
    return void (await t.step('нет задачи harness-retro или бота ИИ — пропуск'));
  await t.check();
  const mark = () =>
    api.db.execute(
      sql`update ai_retro set frictions = 0, last_run_at = now(), updated_at = now() where project_id = ${projectId}::uuid`,
    );
  // a proposal closed by hand — its subtask done, cancelled or archived, not «закрыть» in the thread:
  // closed, its items go back to the clustering instead of hanging on a pending proposal
  await api.db.execute(
    sql`update ai_retro_proposals x set state = 'closed', updated_at = now()
        from tasks t join statuses st on st.id = t.status_id
        where x.task_id = t.id and x.project_id = ${projectId}::uuid and x.state = 'pending'
          and (t.archived_at is not null or st.category in ('done', 'cancelled'))`,
  );
  const items = await rows(
    api.db,
    sql`select t.id, p.key || '-' || coalesce(t.number::text, '?') as key, t.title, t.description
        from tasks t join projects p on p.id = t.project_id join statuses st on st.id = t.status_id
        where t.parent_id = ${s.taskId}::uuid and t.archived_at is null and st.category not in ('done', 'cancelled')
          and not exists (select 1 from ai_retro_proposals x where x.task_id = t.id)
          and not exists (select 1 from ai_retro_proposals x where x.state = 'pending' and t.id = any(x.items))
        order by t.created_at limit 60`,
  );
  const pack = await activePack(api.db, projectId);
  // nothing to cluster, or no harness to edit
  if (!items.length || !pack) {
    await t.step(
      !pack
        ? 'нет активного harness-пакета — нечего править'
        : 'нет новых подзадач — нечего обрабатывать',
    );
    return void (await mark());
  }
  await t.step(`подзадач к обработке: ${items.length}, запрос к ИИ`);
  await t.check();
  const prompt = [
    '# Подзадачи harness-retro',
    ...items.map(
      (i) =>
        `\n## ${i.key as string}: ${i.title as string}\n${cut(md(i.description as JSONContent), 1500)}`,
    ),
    '',
    packText(pack),
  ].join('\n');
  const r = await llmRun(api, projectId, s.taskId, {
    schema: retroSchema,
    system: RETRO_PROMPT,
    prompt,
    signal: t.signal,
  });
  // aborted while the AI answered: nothing of the answer goes in
  await abortedRun(api, t, r);
  if (!r)
    return void (await t.step(
      'ИИ не ответил: нет подключения, исчерпан лимит или ошибка провайдера',
      {
        level: 'error',
      },
    ));
  const log: string[] = [];
  for (const p of r.object.proposals) {
    await abortedRun(api, t, r);
    await propose(api, { projectId, retroTaskId: s.taskId, bot, pack, items }, p).then(
      () => t.step(`предложение: «${p.title}»`, { level: 'action' }),
      (e) => log.push(`«${p.title}»: ${errText(e)}`),
    );
  }
  t.count(items.length);
  await t.step(
    `обработано подзадач: ${items.length}, предложений: ${r.object.proposals.length - log.length}${log.length ? `, ошибок: ${log.length}` : ''}`,
    { level: log.length ? 'error' : 'info' },
  );
  await endRun(api.db, r.runId, 'done', log.join('\n'));
  await mark();
}

async function propose(
  api: JobApi,
  c: { projectId: string; retroTaskId: string; bot: string; pack: ActivePack; items: Row[] },
  p: Proposal,
) {
  const { projectId, pack } = c;
  const pageId = pack.pageIds[p.action] ?? null;
  let base = '';
  let name = p.newAction?.name ?? p.action;
  let ymlDiff: string | null = null;
  let newAction: RetroNewAction | null = null;
  if (pageId) {
    base = pack.instructions[p.action]?.prompt ?? '';
    name = pack.instructions[p.action]?.name ?? p.action;
  } else {
    if (!p.newAction || !AI_ACTION_KEY_RE.test(p.action))
      throw new Error(`действия ${p.action} нет в пакете`);
    newAction = {
      name: p.newAction.name,
      description: p.newAction.description,
      rule: p.newAction.rule,
    };
    ymlDiff = diffBlock(pack.yml, withAction(pack.yml, p.action, newAction.rule));
  }
  if (p.prompt.trim() === base.trim()) return;
  const admin = await adminOf(api.db, projectId);
  if (!admin) throw new Error('в проекте нет администратора');
  const items = c.items.filter((i) => p.items.includes(i.key as string));
  // only an edit of an existing page goes in at once: a new action needs the pack applied anyway
  const auto = p.auto && !!pageId;
  const id = uuidv7();
  const taskId = uuidv7();
  const commentId = uuidv7();
  const desc = [
    p.why,
    items.length
      ? `Подзадачи: ${items.map((i) => `${i.key as string} «${i.title as string}»`).join(', ')}.`
      : '',
    auto ? 'Diff — в комментарии.' : 'Diff — в комментарии; решение — ответом в его треде.',
  ]
    .filter(Boolean)
    .join('\n\n');
  await api.execute(
    c.bot,
    [
      {
        name: 'task.create',
        args: {
          id: taskId,
          projectId,
          parentId: c.retroTaskId,
          statusId: await clarifyOf(api.db, projectId),
          title: cut(`Правка harness: ${p.title}`, 200),
          rank: generateKeyBetween(await lastRank(api.db, projectId, c.retroTaskId), null),
          description: asDoc(desc),
          assignees: [{ id: uuidv7(), userId: admin.id }],
        },
      },
      {
        name: 'comment.create',
        args: {
          id: commentId,
          taskId,
          ...(!auto && { assigneeId: admin.id }),
          body: withMention(
            asDoc(proposalComment(name, p.action, base, p.prompt, ymlDiff, auto)),
            admin.id,
            admin.login,
          ),
        },
      },
    ],
    {
      system: true,
      after: async (q) => {
        await q.execute(
          sql`insert into ai_retro_proposals (id, project_id, task_id, comment_id, assignee_id, action_key, page_id,
                base, prompt, new_action, title, items, state)
              values (${id}, ${projectId}::uuid, ${taskId}, ${commentId}, ${admin.id}::uuid, ${p.action}, ${pageId},
                ${base}, ${p.prompt}, ${newAction ? JSON.stringify(newAction) : null}::jsonb, ${p.title},
                ${`{${items.map((i) => i.id as string).join(',')}}`}::uuid[], 'pending')`,
        );
      },
    },
  );
  if (!auto) return;
  const row: ProposalRow = {
    id,
    projectId,
    taskId,
    commentId,
    assigneeId: admin.id,
    actionKey: p.action,
    pageId,
    base,
    prompt: p.prompt,
    newAction,
    title: p.title,
    items: items.map((i) => i.id as string),
    state: 'pending',
  };
  try {
    const done = await applyProposal(api, row, c.bot, true);
    await closeProposal(api, row, c.bot, 'applied');
    await say(api, c.bot, taskId, commentId, `Применено автоматически. ${done}`);
  } catch (e) {
    // stays an ordinary proposal for the admin
    await say(
      api,
      c.bot,
      taskId,
      commentId,
      `Автоматически не применено: ${errText(e)}. ${ANSWER_HINT}`,
    );
  }
}

/** The bot's reply in a thread of a proposal's subtask. */
const say = (api: JobApi, bot: string, taskId: string, parentId: string, text: string) =>
  api.execute(
    bot,
    [{ name: 'comment.create', args: { id: uuidv7(), taskId, parentId, body: asDoc(text) } }],
    { system: true },
  );

/** The admin's answer in the thread: «применить» / «закрыть»; anything else — what to redo. */
export function retroDecision(text: string): 'apply' | 'close' | 'redo' {
  const t = text
    .trim()
    .replace(/^@\S+\s*/, '')
    .replace(/[.!\s]+$/, '')
    .toLocaleLowerCase();
  if (/^(применить|примени|применяй|да|ок|ok|apply|yes)$/.test(t)) return 'apply';
  if (/^(закрыть|закрой|отклонить|отклоняю|нет|close|no)$/.test(t)) return 'close';
  return 'redo';
}

interface ProposalRow {
  id: string;
  projectId: string;
  taskId: string;
  commentId: string;
  assigneeId: string | null;
  actionKey: string;
  pageId: string | null;
  base: string;
  prompt: string;
  newAction: RetroNewAction | null;
  title: string;
  items: string[];
  /** pending | applied | closed */
  state: string;
}

/** The instruction page's body with a new prompt: the description and the parameters table stay. */
export function withPrompt(body: Doc | null, prompt: string): Doc {
  const nodes = body?.content ?? [];
  const t = nodes.findIndex((n) => n.type === 'table');
  return {
    type: 'doc',
    content: [...(t < 0 ? [] : nodes.slice(0, t + 1)), ...asDoc(prompt).content],
  };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The edit into the pack's pages, on behalf of the admin who decided (their rights; system — the bot's auto-apply).
 * The instruction changed since the proposal (another edit went in) — the edit is carried over onto the current
 * text by the AI, no conflict for the admin. Returns what was done, for the reply.
 */
async function applyProposal(api: JobApi, p: ProposalRow, userId: string, system = false) {
  if (p.pageId) {
    const page = await one(
      api.db,
      sql`select title, body from docs_pages where id = ${p.pageId}::uuid and archived_at is null`,
    );
    if (!page) throw new Error('страница инструкции удалена');
    const cur = parseInstructionPage(page.title as string, page.body).instruction.prompt;
    let prompt = p.prompt;
    let note = 'Инструкция обновлена, следующие прогоны идут по ней.';
    if (norm(cur) !== norm(p.base)) {
      const r = await llmRun(api, p.projectId, p.taskId, {
        schema: rebaseSchema,
        system: REBASE_PROMPT,
        prompt: [
          `## Текущая версия инструкции\n${cur}`,
          `## Правка: ${p.title}`,
          diffBlock(p.base, p.prompt),
        ].join('\n\n'),
      });
      if (!r) throw new Error('инструкция изменилась, а ИИ недоступен, чтобы перенести правку');
      await endRun(api.db, r.runId, 'done', '');
      prompt = r.object.prompt;
      if (norm(prompt) === norm(cur))
        return 'Правка уже есть в текущей инструкции — без изменений.';
      note = `Инструкция изменилась после предложения — правка перенесена на текущую версию:\n\n${diffBlock(cur, prompt)}`;
    }
    await api.execute(
      userId,
      [
        {
          name: 'docs.page.update',
          args: { id: p.pageId, body: withPrompt(page.body as Doc, prompt) },
        },
      ],
      {
        system,
        after: async (q) => {
          await q.execute(
            sql`update ai_retro_proposals set base = ${cur}, prompt = ${prompt}, updated_at = now() where id = ${p.id}`,
          );
        },
      },
    );
    return note;
  }
  const pack = await activePack(api.db, p.projectId);
  if (!pack) throw new Error('в проекте нет активного harness-пакета');
  if (pack.pageIds[p.actionKey] || pack.actions.includes(p.actionKey))
    throw new Error(`действие ${p.actionKey} уже есть в пакете`);
  const yml = withAction(pack.yml, p.actionKey, p.newAction?.rule ?? null);
  const root = await one(
    api.db,
    sql`select space_id as "spaceId", body from docs_pages where id = ${pack.rootId}::uuid`,
  );
  const nodes = ((root!.body as Doc).content ?? []) as JSONContent[];
  const block = harnessBlock(nodes as never) as JSONContent | undefined;
  const last = await one(
    api.db,
    sql`select max(rank collate "C") as r from docs_pages where parent_id = ${pack.rootId}::uuid`,
  );
  await api.execute(userId, [
    {
      name: 'docs.page.update',
      args: {
        id: pack.rootId,
        body: {
          type: 'doc',
          content: nodes.map((n) =>
            n === block ? { ...n, content: [{ type: 'text', text: yml.trim() }] } : n,
          ),
        },
      },
    },
    {
      name: 'docs.page.create',
      args: {
        id: uuidv7(),
        spaceId: root!.spaceId,
        parentId: pack.rootId,
        rank: generateKeyBetween((last?.r as string | null) ?? null, null),
        title: p.newAction?.name ?? p.actionKey,
        body: instructionBody(p.actionKey, {
          name: p.newAction?.name ?? p.actionKey,
          description: p.newAction?.description ?? undefined,
          runtime: 'llm',
          checks: [],
          prompt: p.prompt,
        }),
      },
    },
  ]);
  return 'Страница действия создана, harness.yml дополнен. Чтобы действие и правило появились в проекте, примените пакет: Настройки → ИИ → Пакеты.';
}

/** Resolve the diff comment; an auto-applied one is not assigned — nothing to resolve. */
const resolveDiff = async (q: Exec, commentId: string): Promise<Mut[]> =>
  (await one(
    q,
    sql`select 1 as x from comments where id = ${commentId}::uuid and assignee_id is not null`,
  ))
    ? [{ name: 'comment.resolve', args: { id: commentId, resolved: true } }]
    : [];

/** The proposal is decided: its subtask and the items it covers are closed, the diff comment resolved. */
async function closeProposal(
  api: JobApi,
  p: ProposalRow,
  bot: string,
  state: 'applied' | 'closed',
) {
  const done = await statusOf(api.db, p.projectId, ['done']);
  const end =
    state === 'closed' ? await statusOf(api.db, p.projectId, ['cancelled', 'done']) : done;
  const open = await rows(
    api.db,
    sql`select t.id from tasks t join statuses s on s.id = t.status_id
        where t.id = any(${`{${p.items.join(',')}}`}::uuid[]) and t.archived_at is null
          and s.category not in ('done', 'cancelled')`,
  );
  const muts: Mut[] = [
    { name: 'task.update', args: { id: p.taskId, statusId: end } },
    ...open.map((t) => ({ name: 'task.update', args: { id: t.id, statusId: done } })),
    ...(await resolveDiff(api.db, p.commentId)),
  ];
  await api.execute(bot, muts, {
    system: true,
    after: async (q) => {
      await q.execute(
        sql`update ai_retro_proposals set state = ${state}, updated_at = now() where id = ${p.id}`,
      );
    },
  });
}

/**
 * The admin's remark: the proposal is made again from the current instruction, a new diff comment replaces the old
 * one. A decided proposal (applied, closed) opens again: its subtask goes back to «Уточнение».
 */
async function redo(api: JobApi, p: ProposalRow, remark: string, bot: string) {
  let current = '';
  let name = p.newAction?.name ?? p.actionKey;
  if (p.pageId) {
    const page = await one(
      api.db,
      sql`select title, body from docs_pages where id = ${p.pageId}::uuid and archived_at is null`,
    );
    if (!page) throw new Error('страница инструкции удалена');
    const parsed = parseInstructionPage(page.title as string, page.body);
    current = parsed.instruction.prompt;
    name = parsed.instruction.name;
  }
  const r = await llmRun(api, p.projectId, p.taskId, {
    schema: redoSchema,
    system: REDO_PROMPT,
    prompt: [
      `# Действие \`${p.actionKey}\` — «${name}»`,
      `## Инструкция сейчас\n${current || '— (новое действие)'}`,
      `## Предложенная правка: ${p.title}${p.state === 'applied' ? ' (применена)' : ''}\n${p.prompt}`,
      ...(p.state === 'applied' ? [`## Инструкция до правки\n${p.base}`] : []),
      ...(p.newAction?.rule ? [`## Правило harness.yml\n${p.newAction.rule}`] : []),
      `## Замечание администратора\n${remark}`,
    ].join('\n\n'),
  });
  if (!r) throw new Error('ИИ недоступен: нет подключения или исчерпан лимит');
  const o = r.object;
  const newAction = p.newAction ? { ...p.newAction, rule: o.rule } : null;
  let ymlDiff: string | null = null;
  if (newAction) {
    const pack = await activePack(api.db, p.projectId);
    if (!pack) throw new Error('в проекте нет активного harness-пакета');
    ymlDiff = diffBlock(pack.yml, withAction(pack.yml, p.actionKey, newAction.rule));
  }
  const admin = p.assigneeId
    ? await one(api.db, sql`select id, login from users where id = ${p.assigneeId}::uuid`)
    : undefined;
  const body = asDoc(
    `${o.why ? `${o.why}\n\n` : ''}${proposalComment(name, p.actionKey, current, o.prompt, ymlDiff)}`,
  );
  const commentId = uuidv7();
  await api.execute(
    bot,
    [
      ...(await resolveDiff(api.db, p.commentId)),
      ...(p.state === 'pending'
        ? []
        : [
            {
              name: 'task.update',
              args: { id: p.taskId, statusId: await clarifyOf(api.db, p.projectId) },
            },
          ]),
      {
        name: 'comment.create',
        args: {
          id: commentId,
          taskId: p.taskId,
          ...(admin && { assigneeId: admin.id }),
          body: admin ? withMention(body, admin.id as string, admin.login as string) : body,
        },
      },
    ],
    {
      system: true,
      after: async (q) => {
        await q.execute(
          sql`update ai_retro_proposals set comment_id = ${commentId}, base = ${current}, prompt = ${o.prompt},
              title = ${o.title}, new_action = ${newAction ? JSON.stringify(newAction) : null}::jsonb,
              state = 'pending', updated_at = now()
              where id = ${p.id}`,
        );
      },
    },
  );
  await endRun(api.db, r.runId, 'done', '');
}

async function decide(d: { proposalId: string; replyId: string }, api: JobApi) {
  const p = (await one(
    api.db,
    sql`select id, project_id as "projectId", task_id as "taskId", comment_id as "commentId",
        assignee_id as "assigneeId", action_key as "actionKey", page_id as "pageId", base, prompt,
        new_action as "newAction", title, items, state
        from ai_retro_proposals where id = ${d.proposalId}::uuid`,
  )) as unknown as ProposalRow | undefined;
  const reply = await one(
    api.db,
    sql`select body, author_id as "authorId" from comments where id = ${d.replyId}::uuid`,
  );
  const bot = await botId(api.db);
  if (!p || !reply || !bot) return;
  const answer = (text: string) => say(api, bot, p.taskId, d.replyId, text);
  const text = textOf(reply.body as JSONContent);
  const verdict = retroDecision(text);
  if (verdict !== 'redo' && p.state !== 'pending')
    return void (await answer(
      `Правка уже ${p.state === 'applied' ? 'применена' : 'закрыта'}. Чтобы изменить — напишите, что поменять.`,
    ));
  if (verdict === 'close') {
    await closeProposal(api, p, bot, 'closed');
    return void (await answer('Закрыто: правка не применена.'));
  }
  if (verdict === 'apply') {
    let done: string;
    try {
      done = await applyProposal(api, p, reply.authorId as string);
    } catch (e) {
      return void (await answer(`Не применено: ${errText(e)}. Ответьте, что переделать.`));
    }
    await closeProposal(api, p, bot, 'applied');
    return void (await answer(`Применено. ${done}`));
  }
  if (!(await aiEnabled(api.db))) return void (await answer('ИИ выключен администратором.'));
  try {
    await redo(api, p, md(reply.body as JSONContent) || text, bot);
  } catch (e) {
    await answer(`Не удалось переделать: ${errText(e)}.`);
  }
}

/** The pass over the whole pack: proposals to shorten, dedupe, make consistent (obvious ones go in at once). */
async function runOptimize(projectId: string, api: JobApi, t: Tracker) {
  if (!(await aiEnabled(api.db))) return void (await t.step('ИИ выключен — пропуск'));
  const taskId = await ensureRetroTask(api, projectId);
  const bot = await botId(api.db);
  const pack = await activePack(api.db, projectId);
  if (!taskId || !bot || !pack)
    return void (await t.step(
      'harness-retro выключено или нет активного harness-пакета — пропуск',
    ));
  await t.step('оптимизация инструкций пакета, запрос к ИИ');
  await t.check();
  const r = await llmRun(api, projectId, taskId, {
    schema: retroSchema,
    system: OPTIMIZE_PROMPT,
    prompt: `# harness.yml\n${pack.yml || '—'}\n\n${packText(pack)}`,
    signal: t.signal,
  });
  await abortedRun(api, t, r);
  if (!r)
    return void (await t.step(
      'ИИ не ответил: нет подключения, исчерпан лимит или ошибка провайдера',
      {
        level: 'error',
      },
    ));
  const log: string[] = [];
  for (const p of r.object.proposals) {
    await abortedRun(api, t, r);
    await propose(api, { projectId, retroTaskId: taskId, bot, pack, items: [] }, p).then(
      () => t.step(`${p.auto ? 'применено' : 'предложение'}: «${p.title}»`, { level: 'action' }),
      (e) => log.push(`«${p.title}»: ${errText(e)}`),
    );
  }
  t.count(r.object.proposals.length);
  await t.step(
    `оптимизация: предложений ${r.object.proposals.length - log.length}${log.length ? `, ошибок: ${log.length}` : ''}`,
    { level: log.length ? 'error' : 'info' },
  );
  await endRun(api.db, r.runId, 'done', log.join('\n'));
}

/** The queue ai.retro. */
export async function handleRetro(d: RetroData, api: JobApi): Promise<void> {
  if (d.kind === 'init') return void (await ensureRetroTask(api, d.projectId));
  if (d.kind === 'run')
    return tracked(
      api.db,
      {
        engine: 'harness',
        job: 'retro',
        projectId: d.projectId,
        trigger: d.trigger ?? 'event',
        userId: d.userId ?? null,
      },
      (t) => runRetro(d.projectId, api, t),
    );
  if (d.kind === 'optimize')
    return tracked(
      api.db,
      {
        engine: 'harness',
        job: 'optimize',
        projectId: d.projectId,
        trigger: d.trigger ?? 'cron',
        userId: d.userId ?? null,
      },
      (t) => runOptimize(d.projectId, api, t),
    );
  if (d.kind === 'decide') return decide(d, api);
  // feedback: not about the retro itself
  const t = await one(
    api.db,
    sql`select id, parent_id as "parentId" from tasks where id = ${d.taskId}::uuid`,
  );
  if (!t || (await ownTree(api.db, d.projectId, t as { id: string; parentId: string | null })))
    return;
  if (!(await retroOn(api.db, d.projectId))) return;
  await addItem(api, d.projectId, d.title, d.text);
}

/** Cron: projects whose retro is due by days and that have open items. */
export async function retroTick(_d: object, api: JobApi): Promise<void> {
  await tracked(api.db, { engine: 'harness', job: 'retro_tick', trigger: 'cron' }, (t) =>
    retroDue(api, t),
  );
}

async function retroDue(api: JobApi, t: Tracker) {
  if (!(await aiEnabled(api.db))) return void (await t.step('ИИ выключен — пропуск'));
  const due = await rows(
    api.db,
    sql`select r.project_id as "projectId", p.name from ai_retro r join projects p on p.id = r.project_id
        where r.enabled and r.task_id is not null and 'ai' = any(p.modules)
          and coalesce(r.last_run_at, r.created_at) < now() - make_interval(days => r.every_days)
          and exists (select 1 from tasks t join statuses s on s.id = t.status_id
            where t.parent_id = r.task_id and t.archived_at is null and s.category not in ('done', 'cancelled')
              and not exists (select 1 from ai_retro_proposals x where x.task_id = t.id))`,
  );
  for (const r of due) {
    await api.enqueue(
      RETRO_QUEUE,
      { kind: 'run', projectId: r.projectId, trigger: 'cron' } as RetroData,
      { singletonKey: `retro:${r.projectId as string}`, upsert: true },
    );
    t.count();
    await t.step(`${r.name as string}: пора по расписанию — обработка поставлена в очередь`, {
      projectId: r.projectId as string,
      level: 'action',
    });
  }
  if (!due.length) await t.step('по расписанию проектов к обработке нет');
  // the optimization: once in ENGINE_KEEP_DAYS — its last pass is still in the monitor's history
  const stale = await rows(
    api.db,
    sql`select r.project_id as "projectId", p.name from ai_retro r join projects p on p.id = r.project_id
        join ai_harness_packs h on h.project_id = r.project_id and h.active and h.root_page_id is not null
        where r.enabled and r.task_id is not null and 'ai' = any(p.modules)
          and not exists (select 1 from ai_engine_runs e where e.engine = 'harness' and e.job = 'optimize'
            and e.project_id = r.project_id)`,
  );
  for (const r of stale) {
    await api.enqueue(
      RETRO_QUEUE,
      { kind: 'optimize', projectId: r.projectId, trigger: 'cron' } as RetroData,
      { singletonKey: `retro-optimize:${r.projectId as string}`, upsert: true },
    );
    t.count();
    await t.step(`${r.name as string}: оптимизация правил поставлена в очередь`, {
      projectId: r.projectId as string,
      level: 'action',
    });
  }
}
