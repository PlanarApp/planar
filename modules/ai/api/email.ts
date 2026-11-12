// Emails of an AI run: a batch comment for confirmation, «ок» in its thread sends them one by one (job ai.email).
import { sql } from 'drizzle-orm';
import type { JSONContent } from '@tiptap/core';
import { markdownToDoc } from '@planar/editor/markdown';
import type { AfterMutationCtx, JobApi, ModuleHookApi, Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { esc, loadCfg, safeErr, send, type Send } from '@planar/module-email/api';
import type { AiEmail } from './schema.js';

export const EMAIL_QUEUE = 'ai.email';
/** Emails per project per hour; the rest are put off by whole hours. */
export const EMAILS_PER_HOUR = 20;
/** Pause between two emails, seconds (random within, cumulative). */
const GAP = [30, 60] as const;
const YES = new Set(['ок', 'ok', 'да', 'отправить', 'отправляй']);
const AI_RUN_QUEUE = 'ai.run';

export type EmailData = { batchId: string; index: number };
type Row = Record<string, unknown>;
type Exec = Pick<Q, 'execute'>;
const one = async (q: Exec, s: ReturnType<typeof sql>) =>
  (await q.execute(s)).rows[0] as Row | undefined;
export const textOf = (n: JSONContent): string => n.text ?? (n.content ?? []).map(textOf).join('');

/** «ок» / «ok» / «да» / «отправить» / «отправляй»; case, spaces and a final dot / exclamation mark do not matter. */
export const isYes = (s: string) =>
  YES.has(
    s
      .trim()
      .toLocaleLowerCase()
      .replace(/[.!]+$/, ''),
  );

/** The batch comment: a list (to, subject, text) and how to answer; `to` is mentioned at the start. */
export function batchDoc(
  emails: Pick<AiEmail, 'to' | 'subject' | 'body'>[],
  who: { id: string; login: string },
) {
  const list = emails
    .map(
      (e, i) =>
        `**${i + 1}. Кому:** ${e.to}\n\n**Тема:** ${e.subject}\n\n${e.body.replace(/^/gm, '> ')}`,
    )
    .join('\n\n---\n\n');
  const doc = markdownToDoc(
    `ИИ подготовил письма (${emails.length}). Ответьте «ок» — отправлю; любой другой ответ — правки: письма не уйдут, ИИ переделает.\n\n${list}`,
  ) as { type: 'doc'; content: JSONContent[] };
  return {
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: who.id, label: who.login } },
          { type: 'text', text: ' ' },
        ],
      },
      ...doc.content,
    ],
  };
}

/** insert of the batch row — in the same transaction as the run's changes */
export const insertBatch = (
  b: { runId: string; taskId: string; projectId: string; commentId: string; assigneeId: string },
  emails: Pick<AiEmail, 'to' | 'subject' | 'body'>[],
) =>
  sql`insert into ai_email_batches (id, run_id, task_id, project_id, comment_id, assignee_id, state, emails)
      values (${uuidv7()}, ${b.runId}, ${b.taskId}, ${b.projectId}, ${b.commentId}, ${b.assigneeId}, 'pending',
        ${JSON.stringify(emails.map((e) => ({ ...e, state: 'queued' })))}::jsonb)`;

/**
 * A new reply in the thread. Returns true if the reply is in the thread of a batch comment (handled here):
 * «ок» from its assignee → sending; other text from the assignee → the batch is cancelled and the run restarts
 * with the text in its context; anyone else, a settled batch → nothing.
 */
export async function replied(c: Row, ctx: AfterMutationCtx, api: ModuleHookApi): Promise<boolean> {
  const b = await one(
    api.q,
    sql`select b.id, b.run_id as "runId", b.project_id as "projectId", b.comment_id as "commentId",
        b.state, b.emails, b.assignee_id as "assigneeId" from ai_email_batches b
        where b.comment_id = ${c.parentId as string}`,
  );
  if (!b) return false;
  const root = (await api.sys.get('comments', b.commentId as string)) as Row | undefined;
  // the confirming person is fixed at insert (null — a batch from before the column: the comment's assignee)
  if (b.state !== 'pending' || !root || (b.assigneeId ?? root.assigneeId) !== c.authorId)
    return true;
  // «ок» sends only while the run still waits for the person and the AI is on; otherwise the batch is cancelled
  const yes =
    isYes(textOf(c.body as JSONContent)) &&
    !!(await one(
      api.q,
      sql`select 1 from ai_runs where id = ${b.runId as string} and state = 'waiting_human'
          and not exists (select 1 from ai_settings where id = 1 and not enabled)`,
    ));
  const taken = await one(
    api.q,
    sql`update ai_email_batches set state = ${yes ? 'sending' : 'cancelled'},
        updated_at = now() where id = ${b.id as string} and state = 'pending' returning state`,
  );
  if (!taken) return true;
  const run = await one(
    api.q,
    sql`update ai_runs set state = 'done', updated_at = now() where id = ${b.runId as string} and state = 'waiting_human'
        returning id, kind, task_id as "taskId", item_id as "itemId"`,
  );
  if (taken.state === 'cancelled') {
    if (!run) return true;
    // a checklist item was marked done with the run: the restart needs it open
    if (run.kind === 'checklist')
      await api.sys.patch('checklistItems', run.itemId as string, {
        done: false,
        updatedAt: ctx.now,
      });
    await api.enqueue(AI_RUN_QUEUE, { kind: 'resume', runId: run.id });
    return true;
  }
  // the checklist goes on with the next item
  if (run?.kind === 'checklist')
    await api.enqueue(
      AI_RUN_QUEUE,
      { kind: 'checklist', taskId: run.taskId },
      { singletonKey: `${run.taskId}:checklist`, upsert: true },
    );
  // the hour's budget: emails queued or sent for the project in the last hour (other batches) shift the slots
  const used = await one(
    api.q,
    sql`select count(*)::int as n from ai_email_batches b, jsonb_array_elements(b.emails) e
        where b.project_id = ${b.projectId as string} and b.id <> ${b.id as string}
          and b.state in ('sending', 'sent') and b.updated_at > now() - interval '1 hour'
          and e->>'state' in ('queued', 'sent')`,
  );
  let at = 0;
  const n = (b.emails as AiEmail[]).length;
  for (let i = 0; i < n; i++) {
    at += GAP[0] + Math.floor(Math.random() * (GAP[1] - GAP[0] + 1));
    const hours = Math.floor(((used?.n as number) + i) / EMAILS_PER_HOUR);
    await api.enqueue(EMAIL_QUEUE, { batchId: b.id as string, index: i } satisfies EmailData, {
      startAfter: at + hours * 3600,
    });
  }
  return true;
}

/** One job of ai.email: send the email `index` of a `sending` batch; the last one posts the result to the thread. */
export async function handleEmail(d: EmailData, api: JobApi, snd: Send = send): Promise<void> {
  const b = await one(
    api.db,
    sql`select comment_id as "commentId", task_id as "taskId", emails->${d.index}::int as e from ai_email_batches
        where id = ${d.batchId} and state = 'sending'`,
  );
  const e = b?.e as AiEmail | undefined;
  if (!b || e?.state !== 'queued') return;
  const cfg = await loadCfg(api.db);
  let patch: Pick<AiEmail, 'state' | 'error'> = { state: 'sent' };
  if (!cfg) patch = { state: 'failed', error: 'SMTP не настроен' };
  else
    try {
      await snd(cfg, {
        to: e.to,
        subject: e.subject,
        text: e.body,
        html: `<div style="font-family:sans-serif;font-size:14px;white-space:pre-wrap">${esc(e.body)}</div>`,
      });
    } catch (x) {
      patch = { state: 'failed', error: safeErr(x, cfg) };
    }
  await api.db.execute(
    sql`update ai_email_batches set emails = jsonb_set(emails, ${`{${d.index}}`}::text[], emails->${d.index}::int ||${JSON.stringify(patch)}::jsonb),
        updated_at = now() where id = ${d.batchId}`,
  );
  // the winner of this update — the one who posts the result, once
  const fin = await one(
    api.db,
    sql`update ai_email_batches set state = 'sent', updated_at = now()
        where id = ${d.batchId} and state = 'sending'
          and not exists (select 1 from jsonb_array_elements(emails) x where x->>'state' = 'queued')
        returning emails`,
  );
  if (!fin) return;
  const list = fin.emails as AiEmail[];
  const bad = list.filter((x) => x.state === 'failed');
  const bot = (await one(api.db, sql`select id from users where login = 'ai' and bot`))?.id as
    string | undefined;
  if (!bot) return;
  const text = [
    `Отправлено писем: ${list.length - bad.length} из ${list.length}.`,
    ...bad.map((x) => `- не отправлено на ${x.to}: ${x.error ?? 'ошибка'}`),
  ].join('\n');
  await api.execute(bot, [
    {
      name: 'comment.create',
      args: { id: uuidv7(), taskId: b.taskId, parentId: b.commentId, body: markdownToDoc(text) },
    },
  ]);
}
