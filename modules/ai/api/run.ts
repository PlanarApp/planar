import { APICallError } from 'ai';
import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import { docToMarkdown, markdownToDoc } from '@planar/editor/markdown';
import type { JobApi, Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { matched } from '@planar/module-automations/api';
import { AI_BOT_LOGIN, type AiAction } from '../shared/index.js';
import { resolveConnection, secretOf } from './connections.js';
import { generateStructured, type LlmUsage } from './llm.js';

export const AI_QUEUE = 'ai.run';
/** A run started by another run's changes continues its chain; longer than this — stopped. */
export const MAX_CHAIN = 10;
/** The block of the description the AI owns: replaced on every write, the rest is the people's. */
export const PLAN_HEADING = 'План (ИИ)';

export type AiRunKind = 'action' | 'comment' | 'mention' | 'checklist';

/**
 * Job data. action — by a rule (actionId, ruleId, statusId at the event); comment / mention — itemId is the
 * comment; checklist — the first open item on the bot by rank; resume — the questions of run `runId` are answered.
 */
export type AiRunData =
  | {
      kind: 'action';
      taskId: string;
      actionId: string;
      ruleId?: string | null;
      statusId?: string | null;
      parentRunId?: string | null;
    }
  | { kind: 'comment' | 'mention'; taskId: string; itemId: string }
  | { kind: 'checklist'; taskId: string }
  | { kind: 'resume'; runId: string };

/** Debounce key: one queued job per (task, action / item). */
export const keyOf = (d: AiRunData) =>
  d.kind === 'resume'
    ? `resume:${d.runId}`
    : `${d.taskId}:${d.kind === 'action' ? d.actionId : d.kind === 'checklist' ? 'checklist' : d.itemId}`;

const nullable = <T extends z.ZodType>(s: T) => s.nullable();
/** What the model returns; every field is present (null — not used): strict structured outputs want that. */
export const resultSchema = z.object({
  verdict: z.enum(['done', 'question', 'fail']),
  comment: z.string().max(20_000),
  questions: nullable(z.array(z.string().min(1).max(2000)).max(10)),
  descriptionAppend: nullable(z.string().max(20_000)),
  newTasks: nullable(
    z
      .array(z.object({ title: z.string().min(1).max(500), description: nullable(z.string()) }))
      .max(20),
  ),
  moveTo: nullable(z.string()),
  labels: nullable(z.array(z.string()).max(20)),
  fields: nullable(
    z
      .array(
        z.object({
          name: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        }),
      )
      .max(30),
  ),
  snoozeUntil: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  escalate: nullable(z.string().max(2000)),
  docs: nullable(
    z
      .array(
        z.object({
          parent: z.string().min(1).max(200),
          title: z.string().min(1).max(200),
          markdown: z.string(),
        }),
      )
      .max(5),
  ),
});
export type AiResult = z.infer<typeof resultSchema>;

const SYSTEM = `Ты — ИИ-исполнитель в трекере задач Planar. Ответ — JSON по схеме:
- verdict: done — работа выполнена; question — без ответа человека не обойтись (вопросы — в questions, по одному на пункт); fail — выполнить нельзя (причина — в comment).
- comment: итог для людей, markdown. Пиши на языке задачи.
- descriptionAppend: план или итог в описание задачи, markdown без заголовка; заменяет блок «${PLAN_HEADING}».
- moveTo — имя статуса проекта; labels — имена меток для добавления; fields — значения полей по имени.
- newTasks — подзадачи; snoozeUntil — отложить задачу до даты YYYY-MM-DD; escalate — причина, если нужен руководитель проекта; docs — документы проекта (parent — название корневого раздела, title — заголовок, markdown — текст).
Используй только статусы, метки и поля из списка проекта. Неиспользуемое — null. Изменения (поля, метки, статус, подзадачи) применяются только при done.`;

/** «Поручение»: the built-in prompt until the active harness package has its own (PLNRAPP-169). */
export const ASSIGNMENT_PROMPT = `Выполни поручение человека по контексту задачи. Результат — в comment.
Меняй задачу (поля, метки, статус, подзадачи, план в описании) только если поручение этого прямо требует.
Если без уточнения не обойтись — verdict question.`;

type Row = Record<string, unknown>;
type Doc = { type: 'doc'; content: JSONContent[] };
type Mut = { name: string; args: Record<string, unknown> };

const rows = async (q: Pick<Q, 'execute'>, s: ReturnType<typeof sql>) =>
  (await q.execute(s)).rows as Row[];
const one = async (q: Pick<Q, 'execute'>, s: ReturnType<typeof sql>) => (await rows(q, s))[0];
const norm = (s: string) => s.trim().toLocaleLowerCase();
const textOf = (n: JSONContent): string => n.text ?? (n.content ?? []).map(textOf).join('');
const md = (d: unknown) => (d ? docToMarkdown(d as JSONContent).trim() : '');
const asDoc = (text: string): Doc => markdownToDoc(text);
const mention = (id: string, login: string): JSONContent => ({
  type: 'mention',
  attrs: { id, label: login },
});
/** `@login` of the person at the start of the text: notified and visible in the thread. */
const withMention = (d: Doc, id: string, login: string): Doc => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [mention(id, login), { type: 'text', text: ' ' }] },
    ...d.content,
  ],
});

/** The description with the block «План (ИИ)» replaced (or appended): up to the next heading of level ≤ 2. */
export function withPlan(desc: Doc | null, plan: string): Doc {
  const block = asDoc(`## ${PLAN_HEADING}\n\n${plan}`).content;
  const content = [...(desc?.content ?? [])];
  const isHead = (n: JSONContent | undefined, max: number) =>
    n?.type === 'heading' && Number(n.attrs?.level ?? 1) <= max;
  const i = content.findIndex(
    (n) => n.type === 'heading' && n.attrs?.level === 2 && textOf(n).trim() === PLAN_HEADING,
  );
  if (i < 0) return { type: 'doc', content: [...content, ...block] };
  let j = i + 1;
  while (j < content.length && !isHead(content[j], 2)) j++;
  content.splice(i, j - i, ...block);
  return { type: 'doc', content };
}

const botOf = async (api: JobApi) =>
  (await one(api.db, sql`select id from users where login = ${AI_BOT_LOGIN} and bot`))?.id as
    string | undefined;

interface Task {
  id: string;
  spaceId: string;
  projectId: string;
  statusId: string;
  title: string;
  key: string;
  description: unknown;
  createdBy: string;
  fields: Record<string, unknown>;
  parentId: string | null;
  modules: string[];
  leadId: string | null;
}

async function loadTask(q: Pick<Q, 'execute'>, id: string) {
  return (await one(
    q,
    sql`select t.id, t.space_id as "spaceId", t.project_id as "projectId", t.status_id as "statusId",
        t.title, p.key || '-' || coalesce(t.number::text, '?') as key, t.description,
        t.created_by as "createdBy", t.fields, t.parent_id as "parentId", p.modules, p.lead_id as "leadId"
        from tasks t join projects p on p.id = t.project_id
        where t.id = ${id} and t.archived_at is null`,
  )) as unknown as Task | undefined;
}

/** Who answers a question: the last person assigned (not a guest), else the author. */
async function humanOf(q: Pick<Q, 'execute'>, t: Task) {
  const person = (where: ReturnType<typeof sql>, order: ReturnType<typeof sql>) =>
    one(
      q,
      sql`select u.id, u.login from users u
          join space_members m on m.user_id = u.id and m.space_id = ${t.spaceId} and m.role <> 'guest'
          where not u.bot and u.deactivated_at is null and ${where} ${order} limit 1`,
    ) as Promise<{ id: string; login: string } | undefined>;
  return (
    (await person(
      sql`u.id in (select user_id from task_assignees where task_id = ${t.id})`,
      sql`order by (select max(created_at) from task_assignees where task_id = ${t.id} and user_id = u.id) desc`,
    )) ?? (await person(sql`u.id = ${t.createdBy}`, sql``))
  );
}

/** The task as text for the model: card, vocabulary of the project, checklist, comments with threads. */
async function contextOf(q: Pick<Q, 'execute'>, t: Task, bot: string) {
  const st = await rows(
    q,
    sql`select id, name from statuses where project_id = ${t.projectId} order by rank collate "C"`,
  );
  const lb = await rows(
    q,
    sql`select id, name from labels where project_id = ${t.projectId} order by name`,
  );
  const fd = await rows(
    q,
    sql`select id, name, type from field_defs where project_id = ${t.projectId} order by rank collate "C"`,
  );
  const people = await rows(
    q,
    sql`select u.name from task_assignees a join users u on u.id = a.user_id where a.task_id = ${t.id}`,
  );
  const mine = await rows(
    q,
    sql`select l.name from task_labels x join labels l on l.id = x.label_id where x.task_id = ${t.id}`,
  );
  const items = await rows(
    q,
    sql`select text, done, assignee_id as a from checklist_items where task_id = ${t.id} order by rank collate "C"`,
  );
  const comments = await rows(
    q,
    sql`select * from (select c.id, c.parent_id as p, c.body, c.assignee_id as a, c.resolved_at as r,
          c.created_at as at, u.name from comments c join users u on u.id = c.author_id
          where c.task_id = ${t.id} order by c.created_at desc limit 100) x order by at`,
  );
  const parent = t.parentId
    ? await one(q, sql`select title, description from tasks where id = ${t.parentId}`)
    : undefined;
  const name = (list: Row[], id: unknown) =>
    list.find((x) => x.id === id)?.name as string | undefined;
  const out = [
    `# Задача ${t.key}: ${t.title}`,
    `Статус: ${name(st, t.statusId) ?? '?'}. Исполнители: ${people.map((p) => p.name).join(', ') || '—'}. Метки: ${mine.map((l) => l.name).join(', ') || '—'}.`,
    ...fd.flatMap((f) =>
      t.fields?.[f.id as string] == null
        ? []
        : [`${f.name as string}: ${JSON.stringify(t.fields[f.id as string])}`],
    ),
    '',
    '## Описание',
    md(t.description) || '—',
  ];
  if (parent)
    out.push(
      '',
      `## Родительская задача: ${parent.title as string}`,
      md(parent.description) || '—',
    );
  if (items.length)
    out.push(
      '',
      '## Чек-лист',
      ...items.map(
        (i) => `- [${i.done ? 'x' : ' '}] ${i.text as string}${i.a === bot ? ' (ИИ)' : ''}`,
      ),
    );
  if (comments.length) {
    out.push('', '## Комментарии');
    for (const c of comments)
      out.push(
        '',
        `[${c.id as string}] ${c.name as string}${c.p ? ` → ответ на [${c.p as string}]` : ''}${c.a ? (c.r ? ' (закрыт)' : ' (открыт)') : ''}:`,
        md(c.body),
      );
  }
  out.push(
    '',
    '## Проект',
    `Статусы: ${st.map((s) => s.name).join(', ')}.`,
    `Метки: ${lb.map((l) => l.name).join(', ') || '—'}.`,
    `Поля: ${fd.map((f) => `${f.name as string} (${f.type as string})`).join(', ') || '—'}.`,
  );
  return { text: out.join('\n'), statuses: st, labels: lb, fieldDefs: fd };
}

interface Run {
  id: string;
  kind: AiRunKind;
  task: Task;
  bot: string;
  action?: AiAction;
  /** comment (comment, mention) or checklist item */
  item?: Row;
  log: string[];
}

/** One job of the queue ai.run. */
export async function handle(d: AiRunData, api: JobApi): Promise<void> {
  if (d.kind === 'resume') return resume(d.runId, api);
  const bot = await botOf(api);
  const task = await loadTask(api.db, d.taskId);
  if (!bot || !task || !task.modules.includes('ai')) return;
  let action: AiAction | undefined;
  let item: Row | undefined;
  if (d.kind === 'action') {
    action = (await one(
      api.db,
      sql`select id, key, name, page_id as "pageId", runtime, model, question_status_id as "questionStatusId",
          checks, max_output_tokens as "maxOutputTokens" from ai_actions
          where id = ${d.actionId} and project_id = ${task.projectId}`,
    )) as AiAction | undefined;
    const assigned = await one(
      api.db,
      sql`select 1 from task_assignees where task_id = ${task.id} and user_id = ${bot}`,
    );
    // the event is stale: the task moved on, the AI was unassigned, the rule changed
    if (!action || !assigned || (d.statusId && task.statusId !== d.statusId)) return;
    if (d.ruleId && !(await matched(api, d.ruleId, task.id))) return;
  } else if (d.kind === 'checklist') {
    item = await one(
      api.db,
      sql`select id, text from checklist_items where task_id = ${task.id} and assignee_id = ${bot} and not done
          order by rank collate "C" limit 1`,
    );
    // the item waits for an answer to its question: the next ones wait too (rank order)
    if (
      !item ||
      (await one(
        api.db,
        sql`select 1 from ai_runs where item_id = ${item.id as string} and state = 'waiting_human'`,
      ))
    )
      return;
  } else {
    item = await one(
      api.db,
      sql`select id, author_id as "authorId", assignee_id as "assigneeId", resolved_at as "resolvedAt", body
          from comments where id = ${d.itemId} and task_id = ${task.id}`,
    );
    if (!item || (d.kind === 'comment' && (item.assigneeId !== bot || item.resolvedAt))) return;
  }
  const itemId = (item?.id as string | undefined) ?? null;
  // a newer run of the same pair wins: the older one's result is not applied
  await api.db.execute(
    sql`update ai_runs set state = 'cancelled', updated_at = now()
        where task_id = ${task.id} and kind = ${d.kind} and state in ('running', 'waiting_human')
          and coalesce(action_id, item_id) = ${action?.id ?? itemId}::uuid`,
  );
  const parent =
    d.kind === 'action' && d.parentRunId
      ? await one(
          api.db,
          sql`select chain_id as c, chain_depth as n from ai_runs where id = ${d.parentRunId}`,
        )
      : undefined;
  const id = uuidv7();
  const depth = parent ? (parent.n as number) + 1 : 0;
  await api.db.execute(
    sql`insert into ai_runs (id, task_id, project_id, kind, action_id, rule_id, item_id, state, chain_id, chain_depth)
        values (${id}, ${task.id}, ${task.projectId}, ${d.kind}, ${action?.id ?? null}, ${d.kind === 'action' ? (d.ruleId ?? null) : null},
          ${itemId}, 'running', ${(parent?.c as string | undefined) ?? id}, ${depth})`,
  );
  const run: Run = { id, kind: d.kind, task, bot, action, item, log: [] };
  try {
    if (depth > MAX_CHAIN)
      return await apply(
        api,
        run,
        failed(`Остановлено: цепочка прогонов ИИ длиннее ${MAX_CHAIN}.`),
      );
    if (action?.runtime === 'agent')
      return await apply(api, run, failed('Agent-действия пока не поддерживаются.'));
    const over = await overBudget(api.db, task);
    if (over)
      return await apply(api, run, { ...failed(''), verdict: 'question', questions: [over] });
    const conn = await resolveConnection(api.db, task.projectId);
    if (!conn)
      return await apply(api, run, failed('Нет подключения к ИИ: задайте его в настройках.'));
    let prompt = ASSIGNMENT_PROMPT;
    if (action) {
      const page = action.pageId
        ? await one(
            api.db,
            sql`select text from docs_pages where id = ${action.pageId} and archived_at is null`,
          )
        : undefined;
      if (!page)
        return await apply(api, run, failed(`У действия «${action.name}» нет инструкции.`));
      prompt = page.text as string;
    }
    const ctx = await contextOf(api.db, task, bot);
    const ask =
      d.kind === 'action'
        ? ''
        : d.kind === 'checklist'
          ? `\n\n# Поручение: пункт чек-листа\n${item!.text as string}`
          : `\n\n# Поручение: комментарий [${itemId}]\n${md(item!.body)}`;
    const checks = action?.checks.length
      ? `\n\nКритерии готовности (done — только если все выполнены):\n${action.checks.map((c) => `- ${c}`).join('\n')}`
      : '';
    let result: AiResult;
    let usage: LlmUsage;
    try {
      const c = secretOf(conn);
      ({ object: result, usage } = await generateStructured(
        { ...c, model: action?.model ?? c.model },
        {
          schema: resultSchema,
          system: `${SYSTEM}\n\n# Инструкция\n${prompt}${checks}`,
          prompt: `${ctx.text}${ask}`,
          maxOutputTokens: action?.maxOutputTokens ?? undefined,
        },
      ));
    } catch (e) {
      // the provider's own text is dropped: it may quote the key (as in checkConnection)
      const status = APICallError.isInstance(e) ? ` ${e.statusCode ?? ''}` : '';
      run.log.push(`провайдер: ${e instanceof Error ? e.name : 'error'}${status}`);
      return await apply(api, run, failed('ИИ не ответил: ошибка провайдера.'));
    }
    await api.db.execute(
      sql`update ai_runs set input_tokens = ${usage.inputTokens}, output_tokens = ${usage.outputTokens},
          cost = ${usage.cost} where id = ${id}`,
    );
    await apply(api, run, result, ctx);
  } catch (e) {
    await finish(api.db, run, 'failed', `ошибка: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

const failed = (comment: string): AiResult => ({
  verdict: 'fail',
  comment,
  questions: null,
  descriptionAppend: null,
  newTasks: null,
  moveTo: null,
  labels: null,
  fields: null,
  snoozeUntil: null,
  escalate: null,
  docs: null,
});

/** Budget of the task — the number field «Бюджет» / «Budget», USD; spent = cost of its runs. Over → the question. */
async function overBudget(q: Pick<Q, 'execute'>, t: Task) {
  const f = await one(
    q,
    sql`select id from field_defs where project_id = ${t.projectId} and type = 'number'
        and lower(name) in ('бюджет', 'budget') limit 1`,
  );
  const v = f ? t.fields?.[f.id as string] : null;
  const budget = Number(v);
  if (v == null || !Number.isFinite(budget)) return null;
  const s = await one(
    q,
    sql`select coalesce(sum(cost), 0)::float as s from ai_runs where task_id = ${t.id}`,
  );
  const spent = s!.s as number;
  return spent < budget
    ? null
    : `Бюджет ИИ на задачу исчерпан: потрачено $${spent.toFixed(2)} из $${budget}. Продлить? Увеличьте поле «Бюджет» и ответьте здесь.`;
}

async function finish(q: Pick<Q, 'execute'>, run: Run, state: string, ...log: string[]) {
  run.log.push(...log);
  await q.execute(
    sql`update ai_runs set state = ${state}, log = log || ${run.log.map((l) => `${l}\n`).join('')}, updated_at = now()
        where id = ${run.id} and state = 'running'`,
  );
}

/**
 * The result as the bot's mutations, one transaction; the run row is locked first — a cancelled run applies
 * nothing. The description is read and rewritten under the same lock (read-modify-write of «План (ИИ)»).
 * A rejected change (a bad field value…) rolls back the batch: then only the comment, the run — failed.
 */
async function apply(
  api: JobApi,
  run: Run,
  r: AiResult,
  ctx?: Awaited<ReturnType<typeof contextOf>>,
): Promise<void> {
  const { task, bot } = run;
  const human = await humanOf(api.db, task);
  const muts: Mut[] = [];
  const comment = (text: string, extra: Record<string, unknown> = {}) => {
    const id = uuidv7();
    muts.push({
      name: 'comment.create',
      args: { id, taskId: task.id, body: asDoc(text), ...extra },
    });
    return id;
  };
  // where the answer goes: a thread reply for comment / mention, a top-level comment otherwise
  const reply = run.kind === 'comment' || run.kind === 'mention' ? { parentId: run.item!.id } : {};
  const prefix = run.kind === 'checklist' ? `**${run.item!.text as string}**\n\n` : '';
  let state: 'done' | 'failed' | 'waiting_human' = r.verdict === 'done' ? 'done' : 'failed';
  const questions: string[] = [];
  let returnStatusId: string | null = null;
  let escalateTo: string | null = null;
  let docs: NonNullable<AiResult['docs']> = [];
  const descRef: { m?: Mut } = {};

  if (r.verdict === 'question' && (r.questions?.length || r.comment)) {
    const qs = r.questions?.length ? r.questions : [r.comment];
    if (run.kind === 'comment' || run.kind === 'mention') {
      // in the thread: the assigner / the one who asked answers there
      const author = (await one(
        api.db,
        sql`select id, login from users where id = ${run.item!.authorId as string}`,
      ))!;
      const text = [r.questions?.length ? r.comment : '', ...qs.map((x) => `- ${x}`)]
        .filter(Boolean)
        .join('\n\n');
      muts.push({
        name: 'comment.create',
        args: {
          id: uuidv7(),
          taskId: task.id,
          ...reply,
          body: withMention(asDoc(text), author.id as string, author.login as string),
        },
      });
      if (run.kind === 'comment')
        muts.push({ name: 'comment.assign', args: { id: run.item!.id, assigneeId: author.id } });
      state = 'waiting_human';
    } else if (human) {
      if (r.comment && r.questions?.length) comment(prefix + r.comment);
      for (const x of qs) questions.push(comment(prefix + x, { assigneeId: human.id }));
      if (run.kind === 'action') {
        muts.push({
          name: 'task.assign',
          args: { id: uuidv7(), taskId: task.id, userId: human.id },
        });
        const q = run.action!.questionStatusId;
        if (q && q !== task.statusId) {
          muts.push({ name: 'task.update', args: { id: task.id, statusId: q } });
          returnStatusId = task.statusId;
        }
      }
      state = 'waiting_human';
    } else {
      comment(
        `${prefix}${r.comment}\n\nНекому задать вопрос: у задачи нет исполнителя-человека и автора.`,
      );
    }
  } else if (r.verdict === 'fail') {
    if (r.comment)
      comment(prefix + r.comment, {
        ...reply,
        ...(human && !reply.parentId && { assigneeId: human.id }),
      });
  } else {
    if (r.comment) comment(prefix + r.comment, reply);
    if (ctx) docs = await changes(api.db, run, r, ctx, muts, descRef);
    if (r.escalate) {
      const lead = task.leadId
        ? await one(
            api.db,
            sql`select id, login from users where id = ${task.leadId} and not bot and deactivated_at is null`,
          )
        : undefined;
      if (lead) {
        muts.push({
          name: 'comment.create',
          args: {
            id: uuidv7(),
            taskId: task.id,
            body: withMention(
              asDoc(`Эскалация: ${r.escalate}`),
              lead.id as string,
              lead.login as string,
            ),
          },
        });
        escalateTo = lead.id as string;
      } else run.log.push(`escalate: у проекта нет руководителя — ${r.escalate}`);
    }
    if (run.kind === 'comment')
      muts.push({ name: 'comment.resolve', args: { id: run.item!.id, resolved: true } });
    if (run.kind === 'checklist')
      muts.push({ name: 'checklist.update', args: { id: run.item!.id, done: true } });
  }

  let cancelled = false;
  const exec = (list: Mut[], withDesc: boolean) =>
    api.execute(bot, list, {
      origin: { aiRunId: run.id, depth: 0 },
      prepare: async (q) => {
        const s = await one(q, sql`select state from ai_runs where id = ${run.id} for update`);
        if (s?.state !== 'running') {
          cancelled = true;
          return false;
        }
        if (withDesc && descRef.m) {
          const t = await one(
            q,
            sql`select description from tasks where id = ${task.id} for update`,
          );
          descRef.m.args.description = withPlan(
            (t?.description as Doc | null) ?? null,
            descRef.m.args.plan as string,
          );
          delete descRef.m.args.plan;
        }
      },
      after: async (q, enqueue) => {
        await q.execute(
          sql`update ai_runs set state = ${state}, return_status_id = ${returnStatusId},
              question_comment_ids = ${
                questions.length
                  ? sql`array[${sql.join(
                      questions.map((x) => sql`${x}::uuid`),
                      sql`, `,
                    )}]`
                  : sql`'{}'::uuid[]`
              },
              log = log || ${run.log.map((l) => `${l}\n`).join('')}, updated_at = now() where id = ${run.id}`,
        );
        // the next item of the checklist, in rank order
        if (run.kind === 'checklist' && state === 'done')
          await enqueue(
            AI_QUEUE,
            { kind: 'checklist', taskId: task.id },
            { singletonKey: `${task.id}:checklist`, upsert: true },
          );
      },
    });
  try {
    await exec(muts, true);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    run.log.push(`не применено: ${why}`);
    state = 'failed';
    returnStatusId = null;
    questions.length = 0;
    escalateTo = null;
    docs = [];
    await exec(
      [
        {
          name: 'comment.create',
          args: {
            id: uuidv7(),
            taskId: task.id,
            ...reply,
            body: asDoc(`${r.comment}\n\nИзменения не применены: ${why}`),
          },
        },
      ],
      false,
    );
  }
  if (cancelled) return;
  // separate transactions: the lead watches on their own behalf; pages — after the run's own changes
  if (escalateTo)
    await api.execute(
      escalateTo,
      [{ name: 'task.watch', args: { id: uuidv7(), taskId: task.id } }],
      {
        system: true,
        origin: { aiRunId: run.id, depth: 0 },
      },
    );
  for (const d of docs)
    await writeDoc(api, run, d).catch((e) =>
      note(api.db, run.id, `docs «${d.title}»: ${e instanceof Error ? e.message : String(e)}`),
    );
}

const note = (q: Pick<Q, 'execute'>, id: string, line: string) =>
  q.execute(sql`update ai_runs set log = log || ${`${line}\n`} where id = ${id}`);

/** done: the task changes — names resolved within the project; unknown names are dropped into the log. */
async function changes(
  q: Pick<Q, 'execute'>,
  run: Run,
  r: AiResult,
  ctx: Awaited<ReturnType<typeof contextOf>>,
  muts: Mut[],
  descRef: { m?: Mut },
) {
  const { task } = run;
  const byName = (list: Row[], n: string) =>
    list.find((x) => norm(x.name as string) === norm(n))?.id as string | undefined;
  const upd: Record<string, unknown> = {};
  if (r.descriptionAppend) {
    descRef.m = { name: 'task.update', args: { id: task.id, plan: r.descriptionAppend } };
    muts.push(descRef.m);
  }
  if (r.moveTo) {
    const s = byName(ctx.statuses, r.moveTo);
    if (s) upd.statusId = s;
    else run.log.push(`moveTo: нет статуса «${r.moveTo}»`);
  }
  if (r.snoozeUntil) {
    upd.startDate = r.snoozeUntil;
    const s = byName(ctx.statuses, 'Отложено');
    if (s && !upd.statusId) upd.statusId = s;
  }
  if (Object.keys(upd).length) muts.push({ name: 'task.update', args: { id: task.id, ...upd } });
  for (const n of r.labels ?? []) {
    const l = byName(ctx.labels, n);
    if (l)
      muts.push({ name: 'task.addLabel', args: { id: uuidv7(), taskId: task.id, labelId: l } });
    else run.log.push(`labels: нет метки «${n}»`);
  }
  for (const f of r.fields ?? []) {
    const id = byName(ctx.fieldDefs, f.name);
    if (id)
      muts.push({ name: 'task.setField', args: { taskId: task.id, fieldId: id, value: f.value } });
    else run.log.push(`fields: нет поля «${f.name}»`);
  }
  if (r.newTasks?.length) {
    const first = await one(
      q,
      sql`select id from statuses where project_id = ${task.projectId}
          order by case category when 'todo' then 0 when 'backlog' then 1 else 2 end, rank collate "C" limit 1`,
    );
    const last = await one(
      q,
      sql`select max(rank collate "C") as r from tasks where parent_id = ${task.id}`,
    );
    let rank = (last?.r as string | null) ?? null;
    for (const n of r.newTasks) {
      rank = generateKeyBetween(rank, null);
      muts.push({
        name: 'task.create',
        args: {
          id: uuidv7(),
          projectId: task.projectId,
          parentId: task.id,
          statusId: first!.id,
          title: n.title,
          rank,
          ...(n.description && { description: asDoc(n.description) }),
        },
      });
    }
  }
  if (r.docs?.length && !task.modules.includes('docs')) {
    run.log.push('docs: модуль docs в проекте выключен');
    return [];
  }
  return r.docs ?? [];
}

/** A page under the project's root page `parent` (created if missing); a page with the same title is rewritten. */
async function writeDoc(api: JobApi, run: Run, d: NonNullable<AiResult['docs']>[number]) {
  const { task, bot } = run;
  const page = (parentId: string | null, title: string) =>
    one(
      api.db,
      sql`select id from docs_pages where project_id = ${task.projectId} and archived_at is null
          and ${parentId ? sql`parent_id = ${parentId}` : sql`parent_id is null`} and title = ${title} limit 1`,
    );
  const lastRank = async (parentId: string | null) =>
    ((
      await one(
        api.db,
        sql`select max(rank collate "C") as r from docs_pages where project_id = ${task.projectId}
          and ${parentId ? sql`parent_id = ${parentId}` : sql`parent_id is null`}`,
      )
    )?.r as string | null) ?? null;
  const muts: Mut[] = [];
  let root = (await page(null, d.parent))?.id as string | undefined;
  if (!root) {
    root = uuidv7();
    muts.push({
      name: 'docs.page.create',
      args: {
        id: root,
        spaceId: task.spaceId,
        projectId: task.projectId,
        rank: generateKeyBetween(await lastRank(null), null),
        title: d.parent,
      },
    });
  }
  const had = muts.length ? undefined : ((await page(root, d.title))?.id as string | undefined);
  const id = had ?? uuidv7();
  muts.push(
    had
      ? { name: 'docs.page.update', args: { id, body: asDoc(d.markdown) } }
      : {
          name: 'docs.page.create',
          args: {
            id,
            spaceId: task.spaceId,
            parentId: root,
            rank: generateKeyBetween(muts.length ? null : await lastRank(root), null),
            title: d.title,
            body: asDoc(d.markdown),
          },
        },
    { name: 'docs.link.add', args: { id: uuidv7(), pageId: id, taskId: task.id } },
  );
  await api.execute(bot, muts, { origin: { aiRunId: run.id, depth: 0 } });
}

/**
 * Every question of a run is answered (the hook moved it waiting_human → done): action — the task goes back to
 * returnStatusId if it is still in «Уточнение» (its rule runs again), without a question status — the action
 * runs again; comment — the assignment is the bot's again; mention / checklist — run again.
 */
async function resume(runId: string, api: JobApi) {
  const r = await one(
    api.db,
    sql`select r.id, r.kind, r.task_id as "taskId", r.action_id as "actionId", r.rule_id as "ruleId",
        r.item_id as "itemId", r.return_status_id as "returnStatusId", a.question_status_id as "questionStatusId",
        t.status_id as "statusId" from ai_runs r join tasks t on t.id = r.task_id
        left join ai_actions a on a.id = r.action_id where r.id = ${runId}`,
  );
  const bot = await botOf(api);
  if (!r || !bot) return;
  const taskId = r.taskId as string;
  const origin = { aiRunId: runId, depth: 0 };
  const again = (d: AiRunData) =>
    api.enqueue(AI_QUEUE, d, { singletonKey: keyOf(d), upsert: true });
  if (r.kind === 'action') {
    if (r.returnStatusId && r.questionStatusId) {
      if (r.statusId === r.questionStatusId)
        await api.execute(
          bot,
          [{ name: 'task.update', args: { id: taskId, statusId: r.returnStatusId } }],
          { origin },
        );
    } else if (r.actionId)
      await again({
        kind: 'action',
        taskId,
        actionId: r.actionId as string,
        ruleId: r.ruleId as string | null,
        parentRunId: runId,
      });
  } else if (r.kind === 'comment') {
    await api.execute(bot, [{ name: 'comment.assign', args: { id: r.itemId, assigneeId: bot } }], {
      origin,
    });
    await again({ kind: 'comment', taskId, itemId: r.itemId as string });
  } else if (r.kind === 'mention')
    await again({ kind: 'mention', taskId, itemId: r.itemId as string });
  else await again({ kind: 'checklist', taskId });
}
