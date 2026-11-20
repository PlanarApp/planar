import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import { docToMarkdown, markdownToDoc } from '@planar/editor/markdown';
import {
  HttpError,
  type CoreServices,
  type JobApi,
  type JobOpts,
  type Q,
} from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { matched } from '@planar/module-automations/api';
import { AI_BOT_LOGIN, type AiAction, type AiEvent, type AiRunKind } from '../shared/index.js';
import { resolveConnection, secretOf } from './connections.js';
import { kbBlock } from './aikb/block.js';
import {
  chatTools,
  lazyTools,
  runPlanned,
  type ChatToolDef,
  type PlannedCall,
} from './chat-tools.js';
import { aiPackTools } from './pack-tools.js';
import { loadPack, parseInstructionPage } from './harness.js';
import type { ChatPending } from './schema.js';
import { batchDoc, insertBatch } from './email.js';
import { collectChat, collectRun } from './retro.js';
import { handleDoc } from './doc-run.js';
import { generateReply, generateStructured, providerLog, type LlmUsage } from './llm.js';
import {
  criteriaOf,
  maxAttemptsOf,
  openBlocker,
  pendingSubtasks,
  review,
  rework,
  reworkBlock,
  siblingsFull,
  wakeParent,
  wokenBlock,
  type CheckedResult,
} from './engine.js';
import {
  agentsFull,
  codeAssignmentPrompt,
  codeTargetOf,
  startAgentRun,
  stopAgent,
  treeBranchBlock,
} from './agent.js';

export const AI_QUEUE = 'ai.run';
/** A run started by another run's changes continues its chain; longer than this — stopped. */
export const MAX_CHAIN = 10;
/** The block of the description the AI owns: replaced on every write, the rest is the people's. */
export const PLAN_HEADING = 'План (ИИ)';
/** PLNRAPP-405: the section of a task's description whose items add to the checks of its action */
export const CRITERIA_HEADING = 'Критерии приёмки';

/** A chat run: the person's message (a dialog, or a quote / @ai of the bot in a channel) the bot answers. */
export interface ChatRunData {
  kind: 'chat';
  messageId: string;
  channelId: string;
  initiatorId: string;
}

/**
 * Job data. action — by a rule (actionId, ruleId, statusId at the event); comment / mention — itemId is the
 * comment; checklist — the first open item on the bot by rank; resume — the questions of run `runId` are answered.
 */
type DocRun<K extends string> = {
  kind: K;
  pageId: string;
  /** docs_comments.id */
  itemId: string;
  restartOf?: string | null;
  runId?: string | null;
};
export type DocRunData = DocRun<'doc_comment'> | DocRun<'doc_mention'>;

export type AiRunData =
  | DocRunData
  | {
      kind: 'action';
      taskId: string;
      actionId: string;
      ruleId?: string | null;
      statusId?: string | null;
      parentRunId?: string | null;
      /** set by a manual restart: the run this one repeats */
      restartOf?: string | null;
      /** id of the row to create: a restart sets it, so the client knows the new run */
      runId?: string | null;
      /** PLNRAPP-405: the subtask's run whose outcome woke this parent */
      wokenBy?: string | null;
    }
  | {
      kind: 'comment' | 'mention';
      taskId: string;
      itemId: string;
      restartOf?: string | null;
      runId?: string | null;
    }
  | { kind: 'checklist'; taskId: string; restartOf?: string | null; runId?: string | null }
  | ChatRunData
  | { kind: 'confirm'; runId: string }
  | { kind: 'resume'; runId: string };

/** Debounce key: one queued job per (task, action / item). */
export const keyOf = (d: AiRunData) =>
  d.kind === 'resume' || d.kind === 'confirm'
    ? `${d.kind}:${d.runId}`
    : d.kind === 'chat'
      ? `chat:${d.messageId}`
      : d.kind === 'doc_comment' || d.kind === 'doc_mention'
        ? `${d.pageId}:${d.itemId}`
        : `${d.taskId}:${d.kind === 'action' ? d.actionId : d.kind === 'checklist' ? 'checklist' : d.itemId}`;

export type TaskRunData = Exclude<
  AiRunData,
  { kind: 'resume' | 'confirm' | 'chat' | 'doc_comment' | 'doc_mention' }
>;
/**
 * AST-1: a task run waits in the queue as a `queued` row (the panel and the status see «Ждёт»); the job carries its
 * id as runId. The older `queued` row of the same key is cancelled — one per key; the handler takes the row over.
 * `attempt` — PLNRAPP-404: the engine's rework / restart counts the attempts of the work.
 */
export async function enqueueRun(
  q: Pick<Q, 'execute'>,
  enqueue: (queue: string, data: object, opts?: JobOpts) => Promise<unknown>,
  d: TaskRunData,
  opts?: JobOpts,
  attempt = 1,
) {
  const id = d.runId ?? uuidv7();
  const key = d.kind === 'action' ? d.actionId : d.kind === 'checklist' ? null : d.itemId;
  await q.execute(
    sql`update ai_runs set state = 'cancelled', updated_at = now()
        where task_id = ${d.taskId} and kind = ${d.kind} and state = 'queued' and id <> ${id}
          and coalesce(item_id, action_id) is not distinct from ${key}::uuid`,
  );
  await q.execute(
    sql`insert into ai_runs (id, task_id, project_id, kind, action_id, rule_id, item_id, state, chain_id, chain_depth, restart_of, attempt)
        select ${id}::uuid, t.id, t.project_id, ${d.kind}::text, ${d.kind === 'action' ? d.actionId : null}::uuid,
          ${d.kind === 'action' ? (d.ruleId ?? null) : null}::uuid,
          ${d.kind === 'comment' || d.kind === 'mention' ? d.itemId : null}::uuid, 'queued', ${id}::uuid, 0,
          ${d.restartOf ?? null}::uuid, ${attempt}::int from tasks t where t.id = ${d.taskId} on conflict (id) do nothing`,
  );
  await enqueue(AI_QUEUE, { ...d, runId: id }, opts);
}

const nullable = <T extends z.ZodType>(s: T) => s.nullable();
/** Anthropic structured outputs: at most this many union-typed (nullable) parameters per schema, else 400 */
export const UNION_LIMIT = 16;
const fieldsSchema = z
  .array(
    z.object({
      name: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
  )
  .max(30);
export const newTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: nullable(z.string()),
  /** status name; null — the first «todo» status */
  status: nullable(z.string()),
  /** PLNRAPP-405: ai — the subtask is the AI's (the bot assigned); after — numbers of the earlier new tasks that
   * block it; checks — its acceptance criteria (the section «Критерии приёмки» of its description) */
  ai: z.boolean(),
  after: z.array(z.number().int().min(0).max(19)).max(20),
  checks: z.array(z.string().min(1).max(500)).max(20),
});
/** What the model returns; every field is present (null — not used): strict structured outputs want that. */
export const resultSchema = z.object({
  verdict: z.enum(['done', 'question', 'fail']),
  comment: z.string().max(20_000),
  questions: nullable(z.array(z.string().min(1).max(2000)).max(10)),
  descriptionAppend: nullable(z.string().max(20_000)),
  newTasks: nullable(z.array(newTaskSchema).max(20)),
  moveTo: nullable(z.string()),
  labels: nullable(z.array(z.string()).max(20)),
  fields: nullable(fieldsSchema),
  /** PLNRAPP-361: changes of the task's existing subtasks, by key; «no change» — empty, not null:
   * Anthropic structured outputs reject more than 16 union-typed parameters (UNION_LIMIT) */
  subtasks: nullable(
    z
      .array(
        z.object({
          key: z.string(),
          title: z.string().max(500),
          moveTo: z.string(),
          labels: z.array(z.string()).max(20),
          fields: fieldsSchema,
        }),
      )
      .max(50),
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
  emails: nullable(
    z
      .array(
        z.object({
          to: z.email().max(320),
          subject: z.string().min(1).max(300),
          body: z.string().min(1).max(20_000),
        }),
      )
      .max(10),
  ),
  /** PLNRAPP-178: what got in the way of the run (unclear instruction, missing data or access); harness-retro takes it */
  friction: nullable(z.string().max(2000)),
  /** PLNRAPP-404: doubts about the result and what was checked — the engine's LLM check takes them up;
   * none — "", not null (UNION_LIMIT) */
  uncertain: z.string().max(2000),
});
export type AiResult = z.infer<typeof resultSchema>;

/**
 * PLNRAPP-452: the model gets the base of the result and only the extra fields the run needs — the whole schema
 * compiles into a grammar the provider refuses (400 «compiled grammar is too large»). An extra field goes in at
 * once when the action's instruction names it; the rest are a table of contents (`need`): the model names what it
 * lacks and the request is repeated once with those fields.
 */
const BASE = [
  'verdict',
  'comment',
  'questions',
  'descriptionAppend',
  'moveTo',
  'labels',
  'friction',
  'uncertain',
] as const;
/** extra field → [its line in the table of contents, its description when it is in the schema] */
const EXTRA = {
  fields: ['значения полей задачи', 'fields — значения полей задачи по имени.'],
  newTasks: [
    'создать подзадачи',
    'newTasks — подзадачи (status — имя статуса или null; ai — поручить ИИ: подзадачу ведут её статус и действие, по её итогу тебя запустят снова, а пока подзадачи ИИ не готовы, задача ждёт их; after — номера (с 0) подзадач этого же списка, которые должны быть готовы раньше; checks — критерии приёмки подзадачи, «$ команда» — проверка командой).',
  ],
  subtasks: [
    'изменить существующие подзадачи',
    'subtasks — изменения существующих подзадач из раздела «Подзадачи»: key — ключ подзадачи; title, moveTo, labels, fields (значения полей по имени) — как у задачи, без изменений — "" или [].',
  ],
  snoozeUntil: ['отложить задачу до даты', 'snoozeUntil — отложить задачу до даты YYYY-MM-DD.'],
  escalate: [
    'позвать руководителя проекта',
    'escalate — причина, если нужен руководитель проекта.',
  ],
  docs: [
    'создать или переписать документ проекта',
    'docs — документы проекта (parent — название корневого раздела, title — заголовок, markdown — текст).',
  ],
  emails: [
    'письма внешним адресатам',
    'emails — письма внешним адресатам (to, subject, body — обычный текст), только при done: они уйдут после подтверждения человеком; сам ничего не отправляй.',
  ],
} as const;
export type Extra = keyof typeof EXTRA;
export const EXTRAS = Object.keys(EXTRA) as Extra[];

/** The schema of one request: the base, the `extras` and, if `toc` is not empty, `need` over it. */
export function wireSchema(extras: readonly Extra[], toc: readonly Extra[]) {
  const s = resultSchema.pick(
    Object.fromEntries([...BASE, ...extras].map((k) => [k, true])) as { verdict: true },
  );
  return (toc.length ? s.extend({ need: z.array(z.enum(toc)) }) : s) as unknown as z.ZodType<
    Partial<AiResult> & { need?: Extra[] }
  >;
}

/** The system text of one request: only the fields of its schema (wireSchema). */
const systemOf = (extras: readonly Extra[], toc: readonly Extra[]) =>
  [
    `Ты — ИИ-исполнитель в трекере задач Planar. Ответ — JSON по схеме:
- verdict: done — работа выполнена; question — без ответа человека не обойтись (вопросы — в questions, по одному на пункт); fail — выполнить нельзя (причина — в comment).
- comment: итог для людей, markdown. Пиши на языке задачи.
- descriptionAppend: план или итог в описание задачи, markdown без заголовка; заменяет блок «${PLAN_HEADING}».
- moveTo — имя статуса проекта; labels — имена меток: «Имя» — поставить, «-Имя» — снять.`,
    ...extras.map((k) => `- ${EXTRA[k][1]}`),
    `- friction — что мешало работе (неясная или противоречивая инструкция, не хватало данных или доступа), одной-двумя фразами; не мешало ничего — null.
- uncertain — в чём не уверен в результате и что проверил сам; сомнений нет — "". Результат проверяет система по критериям готовности, а не по твоей оценке.`,
    toc.length &&
      `- need — имена полей, которых нет в схеме, но без них работу не выполнить: ${toc.map((k) => `${k} — ${EXTRA[k][0]}`).join('; ')}. Тогда запрос повторится с этими полями, а этот ответ отбросится: comment оставь пустым. Не нужны — [].`,
    'В comment не пиши, что сделал то, чего нет в полях этого ответа: подзадачи создаёт только newTasks, документы — только docs.',
    'Используй только статусы, метки и поля из списка проекта. Неиспользуемое — null. Изменения (поля, метки, статус, подзадачи и их изменения) применяются только при done; при question — только labels.',
  ]
    .filter(Boolean)
    .join('\n');

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

/** The action the active pack binds to the event («Настройки → ИИ → Пакеты»); undefined — the built-in prompt. */
async function eventAction(q: Pick<Q, 'execute'>, projectId: string, event: AiEvent) {
  return (await one(
    q,
    sql`select a.id, a.key, a.name, a.page_id as "pageId", a.runtime, a.model, a.question_status_id as "questionStatusId",
        a.checks, a.max_output_tokens as "maxOutputTokens", a.max_attempts as "maxAttempts"
        from ai_harness_packs p join ai_actions a on a.project_id = p.project_id and a.key = p.events ->> ${event}
        where p.project_id = ${projectId}::uuid and p.active`,
  )) as AiAction | undefined;
}

/** PLNRAPP-638: the run of an action without its instruction page fails at once — the reason and the fix. */
const noPrompt = (a: AiAction) =>
  `У действия «${a.name}» нет инструкции: страница промпта не задана или удалена. Задайте действию страницу промпта (pageId) — хватит пары строк.`;

/** The prompt of the action's instruction page; undefined — the page is gone. */
async function promptOf(q: Pick<Q, 'execute'>, action: AiAction) {
  const page = action.pageId
    ? await one(
        q,
        sql`select title, body, text from docs_pages where id = ${action.pageId} and archived_at is null`,
      )
    : undefined;
  if (!page) return undefined;
  try {
    // an instruction page with a parameters table: only the part after it is the prompt
    const parsed = parseInstructionPage(page.title as string, page.body);
    if (parsed.structured) return parsed.instruction.prompt;
  } catch {
    // a broken table: the whole page stays the prompt
  }
  return page.text as string;
}

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
const personOf = (
  q: Pick<Q, 'execute'>,
  t: Task,
  where: ReturnType<typeof sql>,
  order: ReturnType<typeof sql> = sql``,
) =>
  one(
    q,
    sql`select u.id, u.login from users u
        join space_members m on m.user_id = u.id and m.space_id = ${t.spaceId} and m.role <> 'guest'
        where not u.bot and u.deactivated_at is null and ${where} ${order} limit 1`,
  ) as Promise<{ id: string; login: string } | undefined>;

async function humanOf(q: Pick<Q, 'execute'>, t: Task) {
  const person = (where: ReturnType<typeof sql>, order: ReturnType<typeof sql>) =>
    personOf(q, t, where, order);
  return (
    (await person(
      sql`u.id in (select user_id from task_assignees where task_id = ${t.id})`,
      sql`order by (select max(created_at) from task_assignees where task_id = ${t.id} and user_id = u.id) desc`,
    )) ?? (await person(sql`u.id = ${t.createdBy}`, sql``))
  );
}

/** PLNRAPP-405: the last action run of a subtask, for the coordinating parent */
const AI_STATE_TEXT: Record<string, string> = {
  queued: 'ждёт запуска',
  running: 'работает',
  waiting_human: 'ждёт ответа человека',
  waiting_subtasks: 'ждёт свои подзадачи',
  done: 'принято',
  failed: 'ошибка',
  cancelled: 'остановлено',
};

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
  // shortcut: subtasks in other projects are left out (their statuses and labels differ), add if asked
  const subs = await rows(
    q,
    sql`select s.id, p.key || '-' || coalesce(s.number::text, '?') as key, s.title, st.name as status,
        (select string_agg(u.name, ', ') from task_assignees a join users u on u.id = a.user_id where a.task_id = s.id) as people,
        (select string_agg(l.name, ', ') from task_labels x join labels l on l.id = x.label_id where x.task_id = s.id) as labels,
        (select r.state from ai_runs r where r.task_id = s.id and r.kind = 'action'
          order by r.created_at desc, r.id desc limit 1) as ai, ${openBlocker(sql`s.id`)} as blocked
        from tasks s join projects p on p.id = s.project_id join statuses st on st.id = s.status_id
        where s.parent_id = ${t.id} and s.project_id = ${t.projectId} and s.archived_at is null
        order by s.rank collate "C"`,
  );
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
  if (subs.length)
    out.push(
      '',
      '## Подзадачи',
      ...subs.map(
        (s) =>
          `- ${s.key as string}: ${s.title as string} — ${s.status as string}. Исполнители: ${(s.people as string | null) ?? '—'}. Метки: ${(s.labels as string | null) ?? '—'}.${s.ai ? ` ИИ: ${AI_STATE_TEXT[s.ai as string] ?? (s.ai as string)}.` : ''}${s.blocked ? ' Ждёт блокирующие задачи.' : ''}`,
      ),
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
  return { text: out.join('\n'), statuses: st, labels: lb, fieldDefs: fd, subtasks: subs };
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
  if (d.kind === 'chat') return handleChat(d, api);
  if (d.kind === 'confirm') return confirmChat(d.runId, api);
  if (d.kind === 'doc_comment' || d.kind === 'doc_mention') return handleDoc(d, api);
  // a retried delivery, or the run cancelled by a newer one: its row is no longer `queued`
  if (
    d.runId &&
    (await one(
      api.db,
      sql`select 1 as x from ai_runs where id = ${d.runId}::uuid and state <> 'queued'`,
    ))
  )
    return;
  const bot = await botOf(api);
  const task = await loadTask(api.db, d.taskId);
  // a restart must leave a row (the panel polls for it): the failed one with the reason
  const skip = async (why: string) => {
    if (d.runId)
      await api.db.execute(
        sql`update ai_runs set state = ${d.restartOf ? 'failed' : 'cancelled'}, log = ${why + '\n'}, updated_at = now()
            where id = ${d.runId}::uuid and state = 'queued'`,
      );
    if (!d.restartOf || !d.runId || !task) return;
    await api.db.execute(
      sql`insert into ai_runs (id, task_id, project_id, kind, action_id, rule_id, item_id, state, chain_id, chain_depth, restart_of, log)
          values (${d.runId}, ${task.id}, ${task.projectId}, ${d.kind}, ${d.kind === 'action' ? d.actionId : null},
            ${d.kind === 'action' ? (d.ruleId ?? null) : null},
            ${d.kind === 'comment' || d.kind === 'mention' ? d.itemId : null}, 'failed', ${d.runId}, 0, ${d.restartOf}, ${why + '\n'})
          on conflict (id) do nothing`,
    );
  };
  if (!bot || !task || !task.modules.includes('ai'))
    return skip('Перезапуск невозможен: ИИ не настроен в проекте задачи.');
  let action: AiAction | undefined;
  let item: Row | undefined;
  /** PLNRAPP-205: the limit of runs by the rule in a row (`ai_run.maxRuns`) */
  let maxRuns: number | undefined;
  if (d.kind === 'action') {
    action = (await one(
      api.db,
      sql`select id, key, name, page_id as "pageId", runtime, model, question_status_id as "questionStatusId",
          checks, max_output_tokens as "maxOutputTokens", max_attempts as "maxAttempts", review from ai_actions
          where id = ${d.actionId} and project_id = ${task.projectId}`,
    )) as AiAction | undefined;
    // PLNRAPP-405: the criteria of the task's own card add to the action's (prompt, container, LLM check)
    if (action)
      action = { ...action, checks: [...action.checks, ...criteriaOf(md(task.description))] };
    const assigned = await one(
      api.db,
      sql`select 1 from task_assignees where task_id = ${task.id} and user_id = ${bot}`,
    );
    // the event is stale: the task moved on, the AI was unassigned, the rule changed
    if (!action || !assigned || (d.statusId && task.statusId !== d.statusId))
      return skip('Перезапуск невозможен: действие удалено или ИИ снят с задачи.');
    // PLNRAPP-679: «harness-retro» and its items — the retro's bookkeeping, no actions
    if (
      await one(
        api.db,
        sql`select 1 from ai_retro where task_id in (${task.id}::uuid, ${task.parentId}::uuid)`,
      )
    )
      return skip('Действия ИИ не запускаются на задаче harness-retro и её подзадачах.');
    const m = d.ruleId ? await matched(api, d.ruleId, task.id) : undefined;
    if (d.ruleId && !m)
      return skip('Перезапуск невозможен: задача больше не подходит под правило.');
    // PLNRAPP-744: a subtask the AI created with a description needs no triage (a rule on «task created») — its
    // card's criteria joined the triage's checks, the judge rejected the labels three times; its status drives it
    if (
      m?.rule.trigger.type === 'task.created' &&
      !d.restartOf &&
      task.parentId &&
      task.createdBy === bot &&
      md(task.description)
    )
      return skip('Подзадача ИИ с описанием: действие на создание задачи не запускается.');
    // PLNRAPP-405: an open blocker — no run row, the reconcile starts it once the blocker is done
    if ((await one(api.db, sql`select ${openBlocker(sql`${task.id}::uuid`)} as b`))?.b) {
      if (d.restartOf) return skip('Перезапуск невозможен: задачу блокирует незавершённая.');
      if (d.runId)
        await api.db.execute(
          sql`delete from ai_runs where id = ${d.runId}::uuid and state = 'queued'`,
        );
      return;
    }
    maxRuns = m?.rule.actions.flatMap((a) =>
      a.type === 'ai_run' && a.aiActionId === action!.id && a.maxRuns ? [a.maxRuns] : [],
    )[0];
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
      return skip('Перезапуск невозможен: нет пункта чек-листа для ИИ или он ждёт ответа.');
  } else {
    item = await one(
      api.db,
      sql`select id, author_id as "authorId", assignee_id as "assigneeId", resolved_at as "resolvedAt", body
          from comments where id = ${d.itemId} and task_id = ${task.id}`,
    );
    if (!item || (d.kind === 'comment' && (item.assigneeId !== bot || item.resolvedAt)))
      return skip('Перезапуск невозможен: комментарий удалён, решён или ИИ в нём не назначен.');
  }
  // an assignment: the action the active pack binds to the event, else the built-in prompt
  if (d.kind !== 'action') action = await eventAction(api.db, task.projectId, d.kind);
  const itemId = (item?.id as string | undefined) ?? null;
  // an assignment on a task with an open MR: the agent with the repository, as the action «Разработка» (PLNRAPP-195)
  const mr = d.kind === 'action' ? null : await codeTargetOf(api.db, task);
  // an assignment with an agent instruction and no runner answers as llm instead of failing
  const agent = action?.runtime === 'agent' && (d.kind === 'action' || !!process.env.AI_RUNNER_URL);
  // PLNRAPP-405: the agent of a subtask works in the branch of the MR of its tree (the nearest ancestor's)
  const treeMr = d.kind === 'action' && agent ? await codeTargetOf(api.db, task, true) : null;
  // agent containers are limited: over the limit the job waits (agent.ts); the touch tells the reap the job is alive
  if (
    ((agent || mr) && (await agentsFull(api.db, task.projectId))) ||
    (d.kind === 'action' && (await siblingsFull(api.db, task)))
  ) {
    if (d.runId)
      await api.db.execute(
        sql`update ai_runs set updated_at = now() where id = ${d.runId}::uuid and state = 'queued'`,
      );
    return api.enqueue(AI_QUEUE, d, { startAfter: 30 });
  }
  // a newer run of the same pair wins: the older one's result is not applied
  const older = await api.db.execute(
    sql`update ai_runs set state = 'cancelled', updated_at = now()
        where task_id = ${task.id} and kind = ${d.kind} and state in ('running', 'waiting_human', 'waiting_subtasks')
          and coalesce(item_id, action_id) = ${itemId ?? action?.id}::uuid returning id`,
  );
  for (const o of older.rows) await stopAgent(api.db, o.id as string);
  const parent =
    d.kind === 'action' && d.parentRunId
      ? await one(
          api.db,
          sql`select chain_id as c, chain_depth as n from ai_runs where id = ${d.parentRunId}`,
        )
      : undefined;
  const id = d.runId ?? uuidv7();
  const depth = parent ? (parent.n as number) + 1 : 0;
  await api.db.execute(
    sql`insert into ai_runs (id, task_id, project_id, kind, action_id, rule_id, item_id, state, chain_id, chain_depth, restart_of)
        values (${id}, ${task.id}, ${task.projectId}, ${d.kind}, ${action?.id ?? null}, ${d.kind === 'action' ? (d.ruleId ?? null) : null},
          ${itemId}, 'running', ${(parent?.c as string | undefined) ?? id}, ${depth}, ${d.restartOf ?? null})
        on conflict (id) do update set state = 'running', action_id = excluded.action_id, rule_id = excluded.rule_id,
          item_id = excluded.item_id, chain_id = excluded.chain_id, chain_depth = excluded.chain_depth,
          started_at = now(), updated_at = now() where ai_runs.state = 'queued'`,
  );
  const run: Run = { id, kind: d.kind, task, bot, action, item, log: [] };
  try {
    if (depth > MAX_CHAIN)
      return await apply(
        api,
        run,
        failed(`Остановлено: цепочка прогонов ИИ длиннее ${MAX_CHAIN}.`),
      );
    const stop = await blocked(api.db, task.projectId);
    if (stop) {
      run.log.push(stop);
      return await apply(api, run, failed(stop));
    }
    const over = await overBudget(api.db, task);
    if (over)
      return await apply(api, run, { ...failed(''), verdict: 'question', questions: [over] });
    const limit =
      d.kind === 'action' && d.ruleId && maxRuns && !d.restartOf
        ? await overRuns(api.db, id, task.id, action!, d.ruleId, maxRuns)
        : null;
    if (limit)
      return await apply(api, run, { ...failed(''), verdict: 'question', questions: [limit] });
    const conn = await resolveConnection(api.db, task.projectId);
    if (!conn)
      return await apply(api, run, failed('Нет подключения к ИИ: задайте его в настройках.'));
    let prompt = ASSIGNMENT_PROMPT;
    if (action) {
      const p = await promptOf(api.db, action);
      if (p === undefined) return await apply(api, run, failed(noPrompt(action)));
      prompt = p;
    }
    const ctx = await contextOf(api.db, task, bot);
    const ask =
      (d.kind === 'action'
        ? ''
        : d.kind === 'checklist'
          ? `\n\n# Поручение: пункт чек-листа\n${item!.text as string}`
          : `\n\n# Поручение: комментарий [${itemId}]\n${md(item!.body)}`) +
      (await reworkBlock(api.db, id, d.restartOf, maxAttemptsOf(action))) +
      (d.kind === 'action' ? await wokenBlock(api.db, d.wokenBy) : '');
    // the agent reads only its prompt: the assignment and its thread go into it
    const thread =
      (mr || agent) && itemId && d.kind !== 'checklist' ? await threadOf(api.db, itemId) : '';
    if (mr)
      return await startAgentRun(
        api,
        run,
        codeAssignmentPrompt(mr, ask + thread, action && prompt),
        ctx,
        mr,
      );
    if (agent)
      return await startAgentRun(
        api,
        run,
        prompt + (treeMr ? treeBranchBlock(treeMr) : '') + ask + thread,
        ctx,
        treeMr,
      );
    const checks = action?.checks.length
      ? `\n\nКритерии готовности (done — только если все выполнены):\n${action.checks.map((c) => `- ${c}`).join('\n')}`
      : '';
    const instruction = `${prompt}${checks}`;
    // PLNRAPP-452: the extras the instruction names are in the schema at once, the rest — on request (need)
    const named = EXTRAS.filter(
      (k) =>
        new RegExp(`\\b${k}\\b`).test(instruction) ||
        // PLNRAPP-528: a person asks in words, not field names — «подзадачи» in the assignment needs newTasks at once
        (k === 'newTasks' && d.kind !== 'action' && /подзадач/i.test(ask)),
    );
    let result: AiResult;
    let usage: LlmUsage;
    try {
      const c = secretOf(conn);
      const call = (extras: Extra[], toc: Extra[]) =>
        generateStructured(
          { ...c, model: action?.model ?? c.model },
          {
            schema: wireSchema(extras, toc),
            system: `${systemOf(extras, toc)}\n\n# Инструкция\n${instruction}` + kbBlock(),
            prompt: `${ctx.text}${ask}`,
            maxOutputTokens: action?.maxOutputTokens ?? undefined,
          },
        );
      const first = await call(
        named,
        EXTRAS.filter((k) => !named.includes(k)),
      );
      const { need, ...base } = first.object;
      let out: Partial<AiResult> = base;
      usage = first.usage;
      if (need?.length) {
        run.log.push(`запрошены поля результата: ${need.join(', ')}`);
        const more = await call([...new Set([...named, ...need])], []);
        out = more.object;
        usage = {
          inputTokens: usage.inputTokens + more.usage.inputTokens,
          outputTokens: usage.outputTokens + more.usage.outputTokens,
          cost: usage.cost == null || more.usage.cost == null ? null : usage.cost + more.usage.cost,
        };
      }
      result = { ...failed(''), ...out };
    } catch (e) {
      run.log.push(providerLog(e));
      // PLNRAPP-404: a pause and another attempt; the attempts spent — the failure as before
      if (await rework(api, run, 'ошибка провайдера, повтор с паузой', null, 60)) return;
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

/** The thread above the comment (root first, the comment itself excluded) as text; '' — a top-level comment. */
async function threadOf(q: Pick<Q, 'execute'>, commentId: string) {
  const up = await rows(
    q,
    sql`with recursive up as (
          select c.parent_id as id, 1 as n from comments c where c.id = ${commentId}::uuid
          union all select c.parent_id, up.n + 1 from comments c join up on c.id = up.id where up.n < 100)
        select c.id, c.body, u.name from up join comments c on c.id = up.id join users u on u.id = c.author_id
        order by up.n desc`,
  );
  return up.length
    ? `\n\n# Ветка обсуждения (выше поручения)\n${up.map((c) => `[${c.id as string}] ${c.name as string}:\n${md(c.body)}`).join('\n\n')}`
    : '';
}

/** «Чат»: the fallback prompt of the chat answer; the active harness package of the project may have its own. */
export const CHAT_PROMPT = `Ты — ИИ-помощник «ИИ» в чате трекера задач Planar. Отвечай коротко и по делу на языке собеседника, markdown.
Ты отвечаешь на последнее сообщение; предыдущие даны как контекст. Если не знаешь — так и скажи, ничего не выдумывай.
У тебя есть инструменты трекера: они выполняются с правами автора последнего сообщения, не больше. Сразу подключены базовые (знания ai_kb, документация, пакеты harness, чтение задач и документов); остальные подключай find_tools по именам из его описания. Если инструмент вернул отказ — объясни это человеку, обходных путей не ищи.
Опасные действия (удаление и т. п.) инструмент не выполняет, а возвращает needsConfirmation: перечисли, что собираешься сделать, и попроси ответить «да» — выполнит система после подтверждения.
Ты отвечаешь по документации Planar: ищи ответ инструментом search_docs_site, не пересказывай по памяти.
Ты настраиваешь проект: правила автоматизаций, ИИ-действия, статусы, метки, поля, пакеты harness и привязки событий, поля проекта, включение и выключение модулей. Подключения ИИ, GitLab, почты, вебхуки и лимиты ты не меняешь — это только вручную в настройках. Перед настройкой прочитай текущее состояние (инструменты list_*).
Ты обрабатываешь задачи массово: найди их search_tasks с фильтрами, затем меняй пачкой.
Все изменения настроек и пачки — только через needsConfirmation: перечисли, что будет изменено (для пачки — список задач), и жди «да». Без «да» ничего не меняй.`;

const chatInt = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/**
 * Registry tools of the run + packs and event bindings (the registry of JobApi does not have them; their writes need
 * «да») + ai_kb: the sections the knowledge block of the prompt points to (as MCP has it).
 */
async function chatToolDefs(api: JobApi, runId: string): Promise<ChatToolDef[]> {
  const core = {
    db: api.db,
    execute: api.execute,
    systemUserId: () => api.systemUserId,
    enqueue: api.enqueue,
  } as unknown as CoreServices;
  const packs = aiPackTools(core).map((t): ChatToolDef => ({
    name: t.name,
    description: t.description,
    shape: t.shape,
    run: t.run,
    ...(t.write ? { danger: 'delete' as const } : {}),
  }));
  const defs: ChatToolDef[] = [
    ...((await api.tools?.({ aiRunId: runId, depth: 0 })) ?? []),
    ...packs,
  ];
  // dynamic: aikb/index imports sections/runs.ts, which imports this module
  const { aikbSections, detail } = await import('./aikb/index.js');
  const kb: ChatToolDef = {
    name: 'ai_kb',
    description:
      'Planar knowledge base: without section — the list of sections (id — title), with section — its text',
    shape: { section: z.string().optional() },
    run: async (a: { section?: string }) => {
      try {
        return detail(aikbSections([...defs, kb]), a.section);
      } catch (e) {
        throw new HttpError(404, 'not_found', (e as Error).message);
      }
    },
  };
  return [...defs, kb];
}

/**
 * The action of the event `chat` of the project's active harness package; events not chosen yet — its instruction
 * «Чат» (key `chat` or `Чат`); else CHAT_PROMPT.
 */
async function chatPrompt(q: Pick<Q, 'execute'>, projectId: string | null) {
  if (!projectId) return CHAT_PROMPT;
  const pack = await one(
    q,
    sql`select root_page_id as id, events from ai_harness_packs where project_id = ${projectId}::uuid and active`,
  );
  const root = pack?.id as string | undefined;
  if (!root) return CHAT_PROMPT;
  if (pack!.events) {
    const action = await eventAction(q, projectId, 'chat');
    return (action && (await promptOf(q, action))?.trim()) || CHAT_PROMPT;
  }
  try {
    const { instructions } = await loadPack(q as never, projectId, root);
    return (instructions.chat ?? instructions['Чат'])?.prompt.trim() || CHAT_PROMPT;
  } catch {
    // a broken package: the built-in prompt
    return CHAT_PROMPT;
  }
}

/** Last messages of the channel (and the thread of the message) as text for the model. */
async function chatContext(
  q: Pick<Q, 'execute'>,
  channelId: string,
  threadId: string,
  bot: string,
) {
  const msgs = await rows(
    q,
    sql`select * from (select u.name, m.author_id as a, m.body, m.created_at from chat_messages m
          join users u on u.id = m.author_id
          where m.channel_id = ${channelId} and m.deleted_at is null
            and (m.parent_id is null or m.parent_id = ${threadId})
          order by m.created_at desc limit 30) x order by created_at`,
  );
  return msgs
    .map((m) => `${m.name as string}${m.a === bot ? ' (ИИ)' : ''}: ${md(m.body)}`)
    .join('\n\n');
}

/** The bot's message in the channel as the run (origin.aiRunId): a flat answer in a dialog, a thread in a channel. */
const chatSay =
  (api: JobApi, bot: string, runId: string, channelId: string, parentId: string | null) =>
  (text: string) =>
    api.execute(
      bot,
      [
        {
          name: 'chat.message.send',
          args: { id: uuidv7(), channelId, body: asDoc(text), readId: uuidv7(), parentId },
        },
      ],
      { origin: { aiRunId: runId, depth: 0 } },
    );

/**
 * A chat run: the bot answers the message with a message of its own. The model has the tools of the registry
 * with the rights of the initiator only; a dangerous call is not executed — it is saved with the run
 * (waiting_human) and runs after the initiator's «да» in the same thread (job `confirm`, see index.ts).
 */
async function handleChat(d: ChatRunData, api: JobApi) {
  const bot = await botOf(api);
  const m = await one(
    api.db,
    sql`select parent_id as "parentId", author_id as "authorId", body, deleted_at as "deletedAt"
        from chat_messages where id = ${d.messageId} and channel_id = ${d.channelId}`,
  );
  const ch = await one(
    api.db,
    sql`select kind, project_id as "projectId", space_id as "spaceId" from chat_channels where id = ${d.channelId}`,
  );
  if (!bot || !m || !ch || m.deletedAt || m.authorId === bot) return;
  // one run per message (a repeated delivery, an edit)
  if (
    await one(
      api.db,
      sql`select 1 as x from ai_runs where kind = 'chat' and item_id = ${d.messageId}`,
    )
  )
    return;
  const id = uuidv7();
  const projectId = (ch.projectId as string | null) ?? null;
  await api.db.execute(
    sql`insert into ai_runs (id, project_id, channel_id, kind, item_id, state, chain_id, chain_depth)
        values (${id}, ${projectId}, ${d.channelId}, 'chat', ${d.messageId}, 'running', ${id}, 0)`,
  );
  const run = { id, log: [] as string[] };
  const parentId = (m.parentId as string | null) ?? (ch.kind === 'dm' ? null : d.messageId);
  const say = chatSay(api, bot, id, d.channelId, parentId);
  try {
    const stop = await blocked(api.db, projectId);
    const conn = stop
      ? null
      : await resolveConnection(api.db, projectId, (ch.spaceId as string | null) ?? null);
    const fail = stop ?? (conn ? null : 'Нет подключения к ИИ: задайте его в настройках.');
    if (fail) {
      await say(fail);
      return await finish(api.db, run, 'failed', fail);
    }
    const author = (await one(api.db, sql`select name from users where id = ${d.initiatorId}`))
      ?.name as string | undefined;
    const ctx = await chatContext(
      api.db,
      d.channelId,
      (m.parentId as string | null) ?? d.messageId,
      bot,
    );
    const planned: PlannedCall[] = [];
    let reply: Awaited<ReturnType<typeof generateReply>>;
    try {
      const lazy = lazyTools(chatTools(await chatToolDefs(api, id), d.initiatorId, planned));
      reply = await generateReply(secretOf(conn!), {
        system: (await chatPrompt(api.db, projectId)) + kbBlock(),
        prompt: `${ctx}\n\n# Ответь на последнее сообщение${author ? ` (${author})` : ''}`,
        tools: lazy.tools,
        active: lazy.active,
        maxSteps: chatInt('AI_CHAT_MAX_STEPS', 10),
        maxTokens: chatInt('AI_CHAT_MAX_TOKENS', 100_000),
      });
    } catch (e) {
      run.log.push(providerLog(e));
      await say('ИИ не ответил: ошибка провайдера.');
      return await finish(api.db, run, 'failed');
    }
    await api.db.execute(
      sql`update ai_runs set input_tokens = ${reply.usage.inputTokens}, output_tokens = ${reply.usage.outputTokens},
          cost = ${reply.usage.cost} where id = ${id}`,
    );
    const text = reply.text.trim() || '…';
    if (!planned.length) {
      await say(text);
      await finish(api.db, run, 'done');
      await collectChat(api, projectId, m.body, text).catch((e) =>
        note(api.db, id, `harness-retro: ${e instanceof Error ? e.message : String(e)}`),
      );
      return;
    }
    // the plan goes to the DB before the message: the «да» can come at once
    await api.db.execute(
      sql`update ai_runs set pending = ${JSON.stringify({ calls: planned, parentId } satisfies ChatPending)}::jsonb,
          state = 'waiting_human', updated_at = now() where id = ${id} and state = 'running'`,
    );
    await say(
      `${text}\n\n**План действий — нужно подтверждение:**\n${planned
        .map((c) => `- ${c.summary ?? `${c.name} ${JSON.stringify(c.args)}`}`)
        .join('\n')}\n\nОтветьте «да» — выполню от вашего имени; любой другой ответ — отмена.`,
    );
  } catch (e) {
    await finish(api.db, run, 'failed', `ошибка: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

/** The initiator said «да» (the hook moved the run to running): the planned calls run once, as the initiator. */
async function confirmChat(runId: string, api: JobApi) {
  const bot = await botOf(api);
  const r = await one(
    api.db,
    sql`select r.channel_id as "channelId", im.author_id as "initiatorId" from ai_runs r
        join chat_messages im on im.id = r.item_id
        where r.id = ${runId} and r.kind = 'chat' and r.state = 'running' and r.pending is not null`,
  );
  if (!bot || !r) return;
  if (!(await aiEnabled(api.db))) {
    await finish(api.db, { id: runId, log: [] }, 'cancelled', 'ИИ выключен администратором.');
    return;
  }
  // the claim: a repeated delivery finds no plan
  const plan = (
    await one(
      api.db,
      sql`with old as (select pending from ai_runs where id = ${runId} and pending is not null for update)
          update ai_runs r set pending = null from old where r.id = ${runId} returning old.pending`,
    )
  )?.pending as ChatPending | undefined;
  if (!plan) return;
  const run = { id: runId, log: [] as string[] };
  try {
    const lines = await runPlanned(
      await chatToolDefs(api, runId),
      r.initiatorId as string,
      plan.calls,
    );
    await chatSay(api, bot, runId, r.channelId as string, plan.parentId)(lines.join('\n'));
    await finish(api.db, run, 'done');
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
  emails: null,
  friction: null,
  subtasks: null,
  uncertain: '',
});

export async function aiEnabled(q: Pick<Q, 'execute'>) {
  const s = await one(q, sql`select enabled from ai_settings where id = 1`);
  return s ? (s.enabled as boolean) : true;
}

const envLimit = (name: string) => {
  const n = Number(process.env[name]);
  return n > 0 ? n : null;
};

export const defaultLimits = () => ({
  dailyTokens: envLimit('PLANAR_AI_DAILY_TOKENS'),
  dailyCost: envLimit('PLANAR_AI_DAILY_COST'),
  /** PLNRAPP-408: a guard of the autopilot — always a limit */
  dailyTasks: envLimit('AI_DAILY_TASKS') ?? 50,
});

/** Daily limits of a project: its own row and the ones in force (own, else the env defaults); null — no limit. */
export async function projectLimits(q: Pick<Q, 'execute'>, projectId: string) {
  const o = await one(
    q,
    sql`select daily_tokens as "dailyTokens", daily_cost as "dailyCost", daily_tasks as "dailyTasks", autopilot
        from ai_project_limits where project_id = ${projectId}`,
  );
  const own = {
    dailyTokens: (o?.dailyTokens as number | null) ?? null,
    dailyCost: (o?.dailyCost as number | null) ?? null,
    dailyTasks: (o?.dailyTasks as number | null) ?? null,
  };
  const d = defaultLimits();
  return {
    own,
    autopilot: !!o?.autopilot,
    effective: {
      dailyTokens: own.dailyTokens ?? d.dailyTokens,
      dailyCost: own.dailyCost ?? d.dailyCost,
      dailyTasks: own.dailyTasks ?? d.dailyTasks,
    },
  };
}

/** Tokens and cost of the runs created today (UTC day); one project, or the whole instance. */
export async function usedToday(q: Pick<Q, 'execute'>, projectId?: string | null) {
  const u = await one(
    q,
    sql`select coalesce(sum(input_tokens + output_tokens), 0)::float as tokens, coalesce(sum(cost), 0)::float as cost
        from ai_runs where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
        ${projectId ? sql`and project_id = ${projectId}` : projectId === null ? sql`and project_id is null` : sql``}`,
  );
  return { tokens: u!.tokens as number, cost: u!.cost as number };
}

/** PLNRAPP-408: tasks the bot created in the project today (UTC day) — the autopilot's guard */
export async function aiTasksToday(q: Pick<Q, 'execute'>, projectId: string) {
  const r = await one(
    q,
    sql`select count(*)::int as n from tasks t join users u on u.id = t.created_by and u.bot and u.login = ${AI_BOT_LOGIN}
        where t.project_id = ${projectId}
          and t.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`,
  );
  return (r?.n as number | undefined) ?? 0;
}

/** Why a run must not call the LLM: the switch is off, or the project spent its daily limit; null — go on. */
async function blocked(q: Pick<Q, 'execute'>, projectId: string | null) {
  if (!(await aiEnabled(q))) return 'ИИ выключен администратором.';
  // personal chats (no project): only the instance defaults, over the personal chats' total spend
  const l = projectId ? (await projectLimits(q, projectId)).effective : defaultLimits();
  if (l.dailyTokens == null && l.dailyCost == null) return null;
  const u = await usedToday(q, projectId);
  if (l.dailyTokens != null && u.tokens >= l.dailyTokens)
    return `Суточный лимит токенов проекта исчерпан: ${u.tokens} из ${l.dailyTokens}. Прогон остановлен без вызова ИИ.`;
  if (l.dailyCost != null && u.cost >= l.dailyCost)
    return `Суточный лимит стоимости проекта исчерпан: $${u.cost.toFixed(2)} из $${l.dailyCost}. Прогон остановлен без вызова ИИ.`;
  return null;
}

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

/**
 * PLNRAPP-205: the rule has already run the action `max` times in a row on the task — a question to a person.
 * «In a row» — since the last run of the action that is not by this rule, a manual restart, or a run that
 * asked a person (the person answered — the count starts over).
 */
async function overRuns(
  q: Pick<Q, 'execute'>,
  runId: string,
  taskId: string,
  action: AiAction,
  ruleId: string,
  max: number,
) {
  const r = await one(
    q,
    sql`select count(*)::int as n from ai_runs r
        where r.task_id = ${taskId} and r.action_id = ${action.id} and r.rule_id = ${ruleId}
          and r.id <> ${runId} and r.state not in ('cancelled', 'queued')
          and r.created_at > coalesce((
            select max(p.created_at) from ai_runs p
            where p.task_id = ${taskId} and p.action_id = ${action.id} and p.id <> ${runId}
              and (p.rule_id is distinct from ${ruleId}::uuid or p.restart_of is not null
                or cardinality(p.question_comment_ids) > 0)
          ), '-infinity'::timestamptz)`,
  );
  const n = (r?.n as number | undefined) ?? 0;
  return n < max
    ? null
    : `«${action.name}» по правилу запускалось уже ${n} раз подряд — это лимит. Нужна помощь человека: разберитесь с причиной и ответьте здесь.`;
}

async function finish(
  q: Pick<Q, 'execute'>,
  run: Pick<Run, 'id' | 'log'>,
  state: string,
  ...log: string[]
) {
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
  r: CheckedResult,
  ctx?: Awaited<ReturnType<typeof contextOf>>,
): Promise<void> {
  // PLNRAPP-404: a done result is accepted by the engine's checks first (rework / the question otherwise);
  // PLNRAPP-405: not while the run hands the work to the AI's subtasks — the parent's final run is accepted
  const delegates =
    run.kind === 'action' &&
    ((!!r.newTasks?.some((n) => n.ai) &&
      (await projectLimits(api.db, run.task.projectId)).autopilot) ||
      (await pendingSubtasks(api.db, run.task.id, run.bot)) > 0);
  if (
    r.verdict === 'done' &&
    ctx &&
    !delegates &&
    (await review(api, run, r, ctx, (x) => apply(api, run, x, ctx)))
  )
    return;
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
  let state: 'done' | 'failed' | 'waiting_human' | 'waiting_subtasks' =
    r.verdict === 'done' ? 'done' : 'failed';
  const questions: string[] = [];
  let returnStatusId: string | null = null;
  let escalateTo: string | null = null;
  let docs: NonNullable<AiResult['docs']> = [];
  const descRef: { m?: Mut } = {};
  let batch: { commentId: string; assigneeId: string } | null = null;

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
      // PLNRAPP-739: no one to ask — the questions go into the comment, not lost (before: only r.comment)
      const nobody = 'Некому задать вопрос: у задачи нет исполнителя-человека и автора.';
      const list = r.questions?.length ? r.questions.map((x) => `- ${x}`).join('\n') : '';
      comment(prefix + [r.comment, list, nobody].filter(Boolean).join('\n\n'));
      run.log.push(`вопрос: ${nobody}`);
    }
    // a question is asked: only the labels apply (the state label «Ждёт ответа» of a pack)
    if (state === 'waiting_human' && ctx) labelMuts(run, r.labels, ctx.labels, muts);
  } else if (r.verdict === 'fail') {
    if (r.comment)
      comment(prefix + r.comment, {
        ...reply,
        ...(human && !reply.parentId && { assigneeId: human.id }),
      });
  } else {
    // PLNRAPP-528: the comment goes after the changes — what they could not do is added to it, not only to the log
    const notes: string[] = [];
    if (ctx) docs = await changes(api.db, run, r, ctx, muts, descRef, notes);
    if (r.comment || notes.length)
      comment(
        prefix +
          [r.comment, r.uncertain && `**Сомнения:** ${r.uncertain}`, ...notes]
            .filter(Boolean)
            .join('\n\n'),
        reply,
      );
    if (r.emails?.length) {
      // the letters wait for «ок» from whoever confirms: the asker in a thread, else the task's person
      const who = reply.parentId
        ? ((await personOf(api.db, task, sql`u.id = ${run.item!.authorId as string}`)) ?? human)
        : human;
      if (who) {
        batch = { commentId: uuidv7(), assigneeId: who.id };
        muts.push({
          name: 'comment.create',
          args: {
            id: batch.commentId,
            taskId: task.id,
            ...reply,
            assigneeId: who.id,
            body: batchDoc(r.emails, who as { id: string; login: string }),
          },
        });
        state = 'waiting_human';
      } else run.log.push('emails: некому подтвердить письма');
    }
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
        // PLNRAPP-405: the work is laid out into the AI's subtasks — the run waits for them, not holding a slot
        if (state === 'done' && run.kind === 'action' && (await pendingSubtasks(q, task.id, bot))) {
          state = 'waiting_subtasks';
          run.log.push('движок: ждёт подзадачи ИИ');
        }
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
        if (batch && state === 'waiting_human')
          await q.execute(
            insertBatch(
              { runId: run.id, taskId: task.id, projectId: task.projectId, ...batch },
              r.emails!,
            ),
          );
        // the next item of the checklist, in rank order
        if (run.kind === 'checklist' && state === 'done')
          await enqueueRun(
            q,
            enqueue,
            { kind: 'checklist', taskId: task.id },
            { singletonKey: `${task.id}:checklist`, upsert: true },
          );
        if (state !== 'waiting_subtasks') await wakeParent(q, enqueue, run);
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
  // harness-retro (PLNRAPP-178): the friction and the assignment's result — subtasks of «harness-retro»
  await collectRun(api, run, r).catch((e) =>
    note(api.db, run.id, `harness-retro: ${e instanceof Error ? e.message : String(e)}`),
  );
}

const note = (q: Pick<Q, 'execute'>, id: string, line: string) =>
  q.execute(sql`update ai_runs set log = log || ${`${line}\n`} where id = ${id}`);

/**
 * `labels` of the result (PLNRAPP-204): a name — add the label, «-name» — remove it; names of the project's
 * labels, case-insensitive (a label whose own name starts with «-» is added); unknown names go to the log.
 */
function labelMuts(
  run: Run,
  names: string[] | null,
  labels: Row[],
  muts: Mut[],
  taskId = run.task.id,
) {
  const byName = (n: string) =>
    labels.find((x) => norm(x.name as string) === norm(n))?.id as string | undefined;
  for (const n of names ?? []) {
    const add = byName(n);
    const del = !add && n.trim().startsWith('-') ? byName(n.trim().slice(1)) : undefined;
    if (add)
      muts.push({
        name: 'task.addLabel',
        args: { id: uuidv7(), taskId, labelId: add },
      });
    else if (del) muts.push({ name: 'task.removeLabel', args: { taskId, labelId: del } });
    else run.log.push(`labels: нет метки «${n}»`);
  }
}

/** done: the task changes — names resolved within the project; unknown names are dropped into the log. */
async function changes(
  q: Pick<Q, 'execute'>,
  run: Run,
  r: AiResult,
  ctx: Awaited<ReturnType<typeof contextOf>>,
  muts: Mut[],
  descRef: { m?: Mut },
  notes: string[] = [],
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
  labelMuts(run, r.labels, ctx.labels, muts);
  const fieldMuts = (taskId: string, list: AiResult['fields']) => {
    for (const f of list ?? []) {
      const id = byName(ctx.fieldDefs, f.name);
      if (id) muts.push({ name: 'task.setField', args: { taskId, fieldId: id, value: f.value } });
      else run.log.push(`fields: нет поля «${f.name}»`);
    }
  };
  fieldMuts(task.id, r.fields);
  for (const s of r.subtasks ?? []) {
    const id = ctx.subtasks.find((x) => norm(x.key as string) === norm(s.key))?.id as
      string | undefined;
    if (!id) {
      run.log.push(`subtasks: нет подзадачи «${s.key}»`);
      continue;
    }
    const su: Record<string, unknown> = {};
    if (s.title) su.title = s.title;
    if (s.moveTo) {
      const st = byName(ctx.statuses, s.moveTo);
      if (st) su.statusId = st;
      else run.log.push(`subtasks: ${s.key}: нет статуса «${s.moveTo}»`);
    }
    if (Object.keys(su).length) muts.push({ name: 'task.update', args: { id, ...su } });
    labelMuts(run, s.labels, ctx.labels, muts, id);
    fieldMuts(id, s.fields);
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
    // PLNRAPP-408: the guard — at most dailyTasks tasks by the AI per day in the project, the rest are dropped
    const limits = await projectLimits(q, task.projectId);
    const room = Math.max(
      0,
      (limits.effective.dailyTasks ?? Infinity) - (await aiTasksToday(q, task.projectId)),
    );
    const list = r.newTasks.slice(0, room);
    if (list.length < r.newTasks.length) {
      run.log.push(
        `newTasks: суточный лимит задач ИИ (${limits.effective.dailyTasks}) — не создано ${r.newTasks.length - list.length}`,
      );
      notes.push(
        `**Система:** не создано подзадач — ${r.newTasks.length - list.length} из ${r.newTasks.length}: исчерпан суточный лимит задач ИИ (${limits.effective.dailyTasks}).`,
      );
    }
    // without the autopilot the AI does not hand work to itself: its subtasks go to a person in «Уточнение»
    const human = limits.autopilot ? undefined : await humanOf(q, task);
    const ids = list.map(() => uuidv7());
    list.forEach((n, i) => {
      rank = generateKeyBetween(rank, null);
      let status = n.status ? byName(ctx.statuses, n.status) : undefined;
      if (n.status && !status) run.log.push(`newTasks: нет статуса «${n.status}»`);
      const toBot = !!n.ai && limits.autopilot;
      if (n.ai && !toBot) {
        status = run.action?.questionStatusId ?? status;
        run.log.push(`newTasks: ${n.title}: автопилот выключен — подзадача человеку`);
      }
      const assignee = toBot ? run.bot : n.ai ? human?.id : undefined;
      const checks = n.checks?.length
        ? `\n\n## ${CRITERIA_HEADING}\n\n${n.checks.map((c) => `- ${c}`).join('\n')}`
        : '';
      const description = `${n.description ?? ''}${checks}`.trim();
      muts.push({
        name: 'task.create',
        args: {
          id: ids[i],
          projectId: task.projectId,
          parentId: task.id,
          statusId: status ?? first!.id,
          title: n.title,
          rank,
          ...(description && { description: asDoc(description) }),
          ...(assignee && { assignees: [{ id: uuidv7(), userId: assignee }] }),
        },
      });
      // PLNRAPP-405: the order of the work — only earlier tasks of the list block (no cycles)
      for (const b of new Set(n.after ?? []))
        if (b < i)
          muts.push({
            name: 'link.create',
            args: { id: uuidv7(), taskId: ids[b], targetId: ids[i], kind: 'blocks' },
          });
        else run.log.push(`newTasks: ${n.title}: after ${b} — не раньше в списке`);
    });
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
  const again = (d: TaskRunData) =>
    enqueueRun(api.db, api.enqueue, d, { singletonKey: keyOf(d), upsert: true });
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

export {
  apply,
  asDoc,
  blocked,
  botOf,
  contextOf,
  eventAction,
  failed,
  finish,
  loadTask,
  md,
  noPrompt,
  overBudget,
  promptOf,
  withMention,
  type Run,
};
