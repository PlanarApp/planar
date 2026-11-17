// docai-run v2 (docs/contracts/docai.md): an AI run over a page comment — llm path or an agent container (agent.ts).
import { APICallError } from 'ai';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { JobApi, Q } from '@planar/server-kit';
import { applyPagePatch } from '@planar/module-docs/api';
import { uuidv7 } from '@planar/shared';
import { resolveConnection, secretOf } from './connections.js';
import { agentsFull, launchAgent, stopAgent } from './agent.js';
import { kbBlock } from './aikb/block.js';
import { generateStructured } from './llm.js';
import {
  AI_QUEUE,
  asDoc,
  blocked,
  botOf,
  eventAction,
  failed,
  finish,
  md,
  promptOf,
  resultSchema,
  withMention,
  type AiResult,
  type DocRunData,
} from './run.js';

type Row = Record<string, unknown>;
const rows = async (q: Pick<Q, 'execute'>, s: ReturnType<typeof sql>) =>
  (await q.execute(s)).rows as Row[];
const one = async (q: Pick<Q, 'execute'>, s: ReturnType<typeof sql>) => (await rows(q, s))[0];

/** The page edit the model may propose (docai-patch); applied in handleDoc before the reply. */
const pagePatchSchema = z
  .object({
    edits: z
      .array(
        z.object({
          find: z.string().min(1).max(16_384),
          replace: z.string(),
          all: z.boolean().nullable().optional(),
        }),
      )
      .min(1)
      .max(50),
  })
  .nullable();
// built on first use: run.ts imports this file, so its resultSchema is not there yet at load time
/** Result of a runtime agent (task or document): not sent to a model, so no UNION_LIMIT. */
export const agentResultSchema = () => resultSchema.extend({ pagePatch: pagePatchSchema });
// a document has no subtasks; without them the schema stays within UNION_LIMIT
export const docResultSchema = () => agentResultSchema().omit({ subtasks: true });
type DocResult = AiResult & { pagePatch?: unknown };

const DOC_SYSTEM = `Ты — ИИ-помощник в документах Planar. Тебе пишут в комментарии к странице. Ответ — JSON по схеме:
- verdict: done — ответ дан или поручение выполнено; question — без ответа человека не обойтись (вопросы — в questions); fail — выполнить нельзя (причина — в comment).
- comment: ответ в ветку комментариев, markdown. Пиши на языке комментария.
- pagePatch: правки страницы {edits: [{find, replace, all}]} по markdown страницы — только когда поручение (назначенный тебе комментарий) просит изменить страницу; find — точный фрагмент, который встречается в странице ровно один раз (или all=true — заменить все вхождения). Иначе null. Если правки не применятся, поручение останется открытым.
Остальные поля — null. Контекст — JSON: страница (markdown), ветка комментариев, поручение, проект (если страница из пакета harness).`;

/** The system part of an agent run over a page: the result goes over HTTP, the reply and resolve are made by the server. */
const DOC_AGENT_SYSTEM = `Ты — ИИ-агент в документах Planar. Тебе пишут в комментарии к странице; страница, ветка комментариев и поручение — в файле контекста.
Итог верни в result (не вызывай add_doc_comment и resolve_doc_comment — ответ в ветку и закрытие поручения сделает сервер):
- verdict: done — ответ дан или поручение выполнено; question — без ответа человека не обойтись (вопросы — в questions); fail — выполнить нельзя (причина — в comment).
- comment: ответ в ветку комментариев, markdown, на языке комментария.
- pagePatch: правки страницы {edits: [{find, replace, all}]} по markdown страницы — только когда поручение (назначенный тебе комментарий) просит изменить страницу; find — точный фрагмент, который встречается в странице ровно один раз (или all=true). Иначе null. Если правки не применятся, поручение останется открытым.
Остальные поля — null.`;

/** The pack pages of the project: the root of the active pack and its children. */
const packContext = async (q: Pick<Q, 'execute'>, projectId: string, pageId: string) => {
  const inPack = await one(
    q,
    sql`select 1 as x from ai_harness_packs k where k.project_id = ${projectId}::uuid and k.active
        and (k.root_page_id = ${pageId}::uuid
          or k.root_page_id = (select parent_id from docs_pages where id = ${pageId}::uuid))`,
  );
  if (!inPack) return null;
  return {
    statuses: (
      await rows(
        q,
        sql`select id, name from statuses where project_id = ${projectId}::uuid order by rank collate "C"`,
      )
    ).map((s) => ({ id: s.id, name: s.name })),
    rules: await rows(
      q,
      sql`select id, name, description from automations_rules where project_id = ${projectId}::uuid`,
    ),
  };
};

/** The live page of a doc run (with the project's modules); undefined — gone or archived. */
export const docPageOf = (q: Pick<Q, 'execute'>, pageId: string) =>
  one(
    q,
    sql`select g.id, g.space_id as "spaceId", g.project_id as "projectId", g.title, g.body, p.modules
        from docs_pages g left join projects p on p.id = g.project_id
        where g.id = ${pageId} and g.archived_at is null`,
  );
export const docItemOf = (q: Pick<Q, 'execute'>, d: DocRunData) =>
  one(
    q,
    sql`select id, author_id as "authorId", assignee_id as "assigneeId", resolved_at as "resolvedAt", body
        from docs_comments where id = ${d.itemId} and page_id = ${d.pageId}`,
  );

/** The model's context of a doc run (page, thread root first, assignment, pack) and the thread root the answer goes under. */
export async function docContext(
  q: Pick<Q, 'execute'>,
  d: DocRunData,
  page: Row,
  item: Row,
  projectId: string,
) {
  const all = await rows(
    q,
    sql`select c.id, c.parent_id as "parentId", c.body, c.created_at as "createdAt", u.name as author
        from docs_comments c join users u on u.id = c.author_id where c.page_id = ${d.pageId} order by c.created_at, c.id`,
  );
  const byId = new Map(all.map((c) => [c.id as string, c]));
  let root = byId.get(d.itemId)!;
  for (let i = 0; root.parentId && byId.has(root.parentId as string) && i < 100; i++)
    root = byId.get(root.parentId as string)!;
  const rootId = root.id as string;
  const inThread = new Set([rootId]);
  for (const c of all)
    if (c.parentId && inThread.has(c.parentId as string)) inThread.add(c.id as string);
  return {
    rootId,
    ctx: {
      page: { id: d.pageId, title: page.title, markdown: md(page.body) },
      thread: all
        .filter((c) => inThread.has(c.id as string))
        .map((c) => ({ id: c.id, author: c.author, text: md(c.body), createdAt: c.createdAt })),
      assignment: { kind: d.kind, id: d.itemId, text: md(item.body) },
      project: await packContext(q, projectId, d.pageId),
    },
  };
}

export async function handleDoc(d: DocRunData, api: JobApi): Promise<void> {
  if (d.runId && (await one(api.db, sql`select 1 as x from ai_runs where id = ${d.runId}::uuid`)))
    return;
  const bot = await botOf(api);
  const page = await docPageOf(api.db, d.pageId);
  const item = await docItemOf(api.db, d);
  const projectId = page?.projectId as string | null | undefined;
  const skip = async (why: string) => {
    if (!d.restartOf || !d.runId) return;
    await api.db.execute(
      sql`insert into ai_runs (id, page_id, project_id, kind, item_id, state, chain_id, chain_depth, restart_of, log)
          values (${d.runId}, ${d.pageId}, ${projectId ?? null}, ${d.kind}, ${d.itemId}, 'failed', ${d.runId}, 0, ${d.restartOf}, ${why + '\n'})
          on conflict (id) do nothing`,
    );
  };
  if (!bot || !page || !projectId || !(page.modules as string[]).includes('ai'))
    return skip('Перезапуск невозможен: ИИ не настроен в проекте страницы.');
  if (!item || (d.kind === 'doc_comment' && (item.assigneeId !== bot || item.resolvedAt)))
    return skip('Перезапуск невозможен: комментарий удалён, решён или ИИ в нём не назначен.');
  // the pack's action for the event (llm: DOC_SYSTEM + its instruction; agent: a container, if the runner is set)
  const action = await eventAction(
    api.db,
    projectId,
    d.kind === 'doc_comment' ? 'comment' : 'mention',
  );
  const agent = action?.runtime === 'agent' && !!process.env.AI_RUNNER_URL;
  // agent containers are limited: over the limit the job waits (agent.ts)
  if (agent && (await agentsFull(api.db, projectId)))
    return api.enqueue(AI_QUEUE, d, { startAfter: 30 });
  // a newer run of the same pair wins: the older one's result is not applied
  const older = await api.db.execute(
    sql`update ai_runs set state = 'cancelled', updated_at = now()
        where page_id = ${d.pageId} and kind = ${d.kind} and item_id = ${d.itemId} and state in ('running', 'waiting_human') returning id`,
  );
  for (const o of older.rows) await stopAgent(api.db, o.id as string);
  const id = d.runId ?? uuidv7();
  await api.db.execute(
    sql`insert into ai_runs (id, page_id, project_id, kind, item_id, action_id, state, chain_id, chain_depth, restart_of)
        values (${id}, ${d.pageId}, ${projectId}, ${d.kind}, ${d.itemId}, ${agent ? action!.id : null}, 'running', ${id}, 0, ${d.restartOf ?? null})`,
  );
  const run = { id, log: [] as string[] };
  try {
    const { ctx, rootId } = await docContext(api.db, d, page, item, projectId);
    const stop = await blocked(api.db, projectId);
    if (stop) {
      run.log.push(stop);
      return await applyDoc(api, run, d, bot, rootId, item, failed(stop));
    }
    const conn = await resolveConnection(api.db, projectId);
    if (!conn)
      return await applyDoc(
        api,
        run,
        d,
        bot,
        rootId,
        item,
        failed('Нет подключения к ИИ: задайте его в настройках.'),
      );
    // the pack's action for the event; without it — the built-in DOC_SYSTEM
    let instruction = '';
    if (action) {
      const p = await promptOf(api.db, action);
      if (p === undefined)
        return await applyDoc(
          api,
          run,
          d,
          bot,
          rootId,
          item,
          failed(`У действия «${action.name}» нет инструкции.`),
        );
      const checks = action.checks.length
        ? `\n\nКритерии готовности (done — только если все выполнены):\n${action.checks.map((x) => `- ${x}`).join('\n')}`
        : '';
      instruction = `\n\n# Инструкция\n${p}${checks}`;
    }
    // the agent container (as for tasks): the result comes over HTTP into finishAgent
    if (agent)
      return await launchAgent(api, {
        run,
        projectId,
        action: action!,
        prompt: DOC_AGENT_SYSTEM + instruction,
        context: ctx,
        fail: (text) => applyDoc(api, run, d, bot, rootId, item, failed(text)),
      });
    let result: AiResult;
    try {
      const c = secretOf(conn);
      const out = await generateStructured(
        { ...c, model: action?.model ?? c.model },
        {
          schema: docResultSchema(),
          system: DOC_SYSTEM + instruction + kbBlock(),
          prompt: JSON.stringify(ctx),
          maxOutputTokens: action?.maxOutputTokens ?? undefined,
        },
      );
      result = { ...out.object, subtasks: null };
      await api.db.execute(
        sql`update ai_runs set input_tokens = ${out.usage.inputTokens}, output_tokens = ${out.usage.outputTokens},
            cost = ${out.usage.cost} where id = ${id}`,
      );
    } catch (e) {
      // the provider's own text is dropped: it may quote the key
      const status = APICallError.isInstance(e) ? ` ${e.statusCode ?? ''}` : '';
      run.log.push(`провайдер: ${e instanceof Error ? e.name : 'error'}${status}`);
      return await applyDoc(
        api,
        run,
        d,
        bot,
        rootId,
        item,
        failed('ИИ не ответил: ошибка провайдера.'),
      );
    }
    await applyDocResult(api, run, d, bot, rootId, item, result);
  } catch (e) {
    await finish(api.db, run, 'failed', `ошибка: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

/**
 * The result of the model or the container: the page patch (docai-patch: as the bot, before the reply; a failed patch —
 * the assignment stays open, the reason goes into the reply), then the reply and resolve (applyDoc).
 */
export async function applyDocResult(
  api: JobApi,
  run: { id: string; log: string[] },
  d: DocRunData,
  bot: string,
  rootId: string,
  item: Row,
  r: DocResult,
) {
  let result = r;
  let keepOpen = false;
  if (result.pagePatch) {
    const edits = (
      result.pagePatch as { edits: { find: string; replace: string; all?: boolean | null }[] }
    ).edits.map((e) => ({ find: e.find, replace: e.replace, all: e.all ?? undefined }));
    if (d.kind !== 'doc_comment') {
      result = {
        ...result,
        comment: `${result.comment}\n\nПравки страницы игнорируются: их можно просить только в поручении.`,
      };
    } else if (
      (await one(api.db, sql`select state from ai_runs where id = ${run.id}`))?.state === 'running'
    ) {
      try {
        const done = await applyPagePatch(
          { db: api.db, execute: (u, m) => api.execute(u, m) },
          { pageId: d.pageId, edits },
          bot,
        );
        run.log.push(`страница обновлена${done.versionId ? `, версия ${done.versionId}` : ''}`);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        run.log.push(`патч не применён: ${why}`);
        keepOpen = true;
        result = { ...result, comment: `${result.comment}\n\nИзменения не применены: ${why}` };
      }
    }
  }
  await applyDoc(api, run, d, bot, rootId, item, result, keepOpen);
}

/**
 * The reply under the thread root as the bot (one transaction; a cancelled run applies nothing); doc_comment —
 * resolved on done. A question is asked in the thread and the run is done: the person's reply starts a new run.
 * keepOpen (the patch failed): the assignment stays unresolved.
 */
async function applyDoc(
  api: JobApi,
  run: { id: string; log: string[] },
  d: DocRunData,
  bot: string,
  rootId: string,
  item: Row,
  r: Pick<AiResult, 'verdict' | 'comment' | 'questions'>,
  keepOpen = false,
) {
  const asking = r.verdict === 'question' && !!(r.questions?.length || r.comment);
  const author = asking
    ? await one(api.db, sql`select id, login from users where id = ${item.authorId as string}`)
    : undefined;
  const text = asking
    ? [
        r.questions?.length ? r.comment : '',
        ...(r.questions?.length ? r.questions : [r.comment]).map((x) => `- ${x}`),
      ]
        .filter(Boolean)
        .join('\n\n')
    : r.comment;
  const create = (body: ReturnType<typeof asDoc>) => ({
    name: 'docs.comment.create',
    args: { id: uuidv7(), pageId: d.pageId, parentId: rootId, body },
  });
  const muts: { name: string; args: Record<string, unknown> }[] = [];
  if (text)
    muts.push(
      create(
        author
          ? withMention(asDoc(text), author.id as string, author.login as string)
          : asDoc(text),
      ),
    );
  if (d.kind === 'doc_comment') {
    if (author)
      muts.push({ name: 'docs.comment.assign', args: { id: d.itemId, assigneeId: author.id } });
    else if (r.verdict === 'done' && !keepOpen)
      muts.push({ name: 'docs.comment.resolve', args: { id: d.itemId, resolved: true } });
  }
  const state = r.verdict === 'fail' ? 'failed' : 'done';
  const exec = (list: typeof muts, final: string) =>
    api.execute(bot, list, {
      origin: { aiRunId: run.id, depth: 0 },
      prepare: async (q) => {
        const s = await one(q, sql`select state from ai_runs where id = ${run.id} for update`);
        if (s?.state !== 'running') return false;
      },
      after: async (q) => {
        await q.execute(
          sql`update ai_runs set state = ${final}, log = log || ${run.log.map((l) => `${l}\n`).join('')}, updated_at = now()
              where id = ${run.id}`,
        );
      },
    });
  try {
    await exec(muts, state);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    run.log.push(`не применено: ${why}`);
    await exec([create(asDoc(`${r.comment}\n\nИзменения не применены: ${why}`))], 'failed');
  }
}
