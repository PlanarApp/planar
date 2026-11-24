// PLNRAPP-168: AI actions and the llm run flow — ai_run, «Уточнение», answers in the thread, assignments.
// The provider is a local fake of an OpenAI-compatible server: each call takes the next queued result.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encrypt, secretKey } from '@planar/server-kit';
import { appUrl, uuidv7 } from '@planar/shared';
import {
  EMAILS_PER_HOUR,
  MAX_CHAIN,
  PLAN_HEADING,
  handleEmail,
  isYes,
  withPlan,
} from '@planar/module-ai/api';
import { criteriaOf } from '../../../../modules/ai/api/engine.js';
import { markdownToDoc } from '@planar/editor/markdown';
import type { JobApi } from '../../src/modules/hooks.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import { PushService } from '../../src/sync/push.service.js';
import {
  dbUrl,
  doc,
  key,
  newDb,
  services,
  TestClient,
  useProject,
  world,
  type World,
} from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;
let api: JobApi;
let bot: string;
let srv: http.Server;
type Job = { queue: string; data: Record<string, unknown>; opts?: Record<string, unknown> };
const jobs: Job[] = [];
/** results the fake provider returns, in order; onCall runs before the answer */
let answers: object[] = [];
const PROVIDER_400 = {};
let calls: { system: string; prompt: string }[] = [];
/** PLNRAPP-452: the fields of the answer schema of every request to the provider */
let schemas: string[][] = [];
/** PLNRAPP-404: answers of the engine's LLM check, in order, and the prompts it got */
let verdicts: { pass: boolean; failures: string[] }[] = [];
let judged: string[] = [];
let onCall: (() => Promise<void>) | undefined;

const handler = (id: string, q: string) =>
  (
    installed.find((m) => m.api.id === id)!.api.jobs as {
      queue: string;
      handler(d: unknown, api: JobApi): Promise<void>;
    }[]
  ).find((j) => j.queue === q)!.handler;

const result = (o: Record<string, unknown>) => ({
  verdict: 'done',
  comment: 'Готово',
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
  ...o,
});

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = randomBytes(32).toString('base64');
  w = await world(db);
  const svc = { ...services(db), push: new PushService(db, queue) };
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    w[c] = new TestClient(svc, w[c].userId);
  const capture = async (q: string, data: object, o?: object) =>
    void jobs.push({ queue: q, data: data as never, opts: o as never });
  queue.jobs.enqueue = capture;
  api = { ...(await queue.jobs.api()), enqueue: capture };
  srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = JSON.parse(raw) as {
        messages: { role: string; content: string }[];
        response_format?: { json_schema?: { schema?: { properties?: object } } };
      };
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      const prompt = body.messages.find((m) => m.role === 'user')?.content ?? '';
      // PLNRAPP-404: the engine's LLM check has its own queue (default — accepted)
      const judge = system.startsWith('Ты — проверяющий');
      // PLNRAPP-452: like a model — a field the request's schema lacks is first asked for through `need`
      // (that extra request is not in `calls` and costs no tokens, so the tests count as before)
      const props = body.response_format?.json_schema?.schema?.properties ?? {};
      schemas.push(Object.keys(props));
      const queued = (judge ? undefined : answers[0]) as Record<string, unknown> | undefined;
      const lack =
        typeof queued === 'object' && 'need' in props
          ? Object.keys(queued).filter((k) => queued[k] != null && !(k in props))
          : [];
      if (lack.length)
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify(result({ need: lack })) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        );
      if (judge) judged.push(prompt);
      else {
        calls.push({ system, prompt });
        await onCall?.();
      }
      const next = judge
        ? (verdicts.shift() ?? { pass: true, failures: [] })
        : (answers.shift() ?? result({}));
      // the provider refuses, quoting the key
      if (next === PROVIDER_400)
        return void res
          .writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { message: 'schema too complex; key sk-test' } }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'fake',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                // need is required where the schema has it: nothing asked — []
                content: JSON.stringify(
                  'need' in props && typeof next === 'object' ? { need: [], ...next } : next,
                ),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  await raw(`delete from ai_connections`);
  await db.$client.query(
    `insert into ai_connections (id, scope, scope_id, provider, base_url, key_enc, model, price_in, price_out)
     values ($1, 'workspace', '00000000-0000-0000-0000-000000000000', 'openai-compatible', $2, $3, 'fake', 1, 2)`,
    [uuidv7(), base, encrypt('sk-test', secretKey()!)],
  );
});
afterAll(async () => {
  srv.close();
  await raw(`delete from ai_connections`);
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const one = async (text: string, values: unknown[] = []) => (await raw(text, values))[0]!;

/** Runs queued automations.run / ai.run jobs (and those they queue) in order; startAfter is ignored. */
async function drain() {
  for (let i = 0; i < 50; i++) {
    const j = jobs.findIndex((x) => x.queue === 'automations.run' || x.queue === 'ai.run');
    if (j < 0) return;
    const [job] = jobs.splice(j, 1);
    await handler(job!.queue.split('.')[0]!, job!.queue)(job!.data, api);
  }
  throw new Error('drain: too many jobs');
}

let P: string;
let S: { backlog: string; todo: string; done: string; clarify: string; snoozed: string };
let actionId: string;
let pageId: string;

async function project() {
  const id = uuidv7();
  await w.admin.ok('project.create', {
    id,
    spaceId: w.spaceId,
    name: 'AI',
    key: key(),
    rank: 'a0',
  });
  useProject(w, id);
  return id;
}
async function status(name: string, category = 'todo') {
  const id = uuidv7();
  await w.admin.ok('status.create', {
    id,
    projectId: P,
    name,
    category,
    color: '#000',
    rank: `b${name.length}`,
  });
  return id;
}
async function action(over: Record<string, unknown> = {}) {
  const id = uuidv7();
  await w.admin.ok('ai.action.create', {
    id,
    projectId: P,
    key: `k${id.slice(-6)}`,
    name: 'Планирование',
    pageId,
    questionStatusId: S.clarify,
    checks: ['план конечен'],
    ...over,
  });
  return id;
}
async function rule(trigger: object, actions: object[], who = w.admin) {
  const id = uuidv7();
  const r = await who.push('automations.create', {
    id,
    projectId: P,
    name: 'AI',
    trigger,
    conditions: { op: 'and', rules: [{ field: 'assignee', operator: 'in', value: [bot] }] },
    actions,
  });
  return { id, r };
}
async function task(over: Record<string, unknown> = {}) {
  const id = uuidv7();
  await w.admin.ok('task.create', {
    id,
    projectId: P,
    statusId: S.todo,
    title: 'Сделать CRM',
    rank: 'a0',
    assignees: [
      { id: uuidv7(), userId: w.member.userId },
      { id: uuidv7(), userId: bot },
    ],
    ...over,
  });
  return id;
}
const taskRow = (id: string) => one(`select * from tasks where id = $1`, [id]);
const runsOf = (taskId: string) =>
  raw(`select * from ai_runs where task_id = $1 order by created_at, id`, [taskId]);
const commentsOf = (taskId: string) =>
  raw(`select * from comments where task_id = $1 order by created_at, id`, [taskId]);
const text = (body: unknown) => JSON.stringify(body);

beforeEach(async () => {
  P = await project();
  bot = (await one(`select id from users where login = 'ai' and bot`)).id as string;
  const st = await raw(`select id, category from statuses where project_id = $1 order by rank`, [
    P,
  ]);
  const of = (c: string) => st.find((s) => s.category === c)!.id as string;
  S = {
    backlog: of('backlog'),
    todo: of('todo'),
    done: of('done'),
    clarify: await status('Уточнение'),
    snoozed: await status('Отложено', 'backlog'),
  };
  pageId = uuidv7();
  await w.admin.ok('docs.page.create', {
    id: pageId,
    spaceId: w.spaceId,
    projectId: P,
    rank: 'a0',
    title: 'Планирование',
    body: doc('Проверь задачу и составь план.'),
  });
  actionId = await action();
  jobs.length = 0;
  answers = [];
  calls = [];
  verdicts = [];
  judged = [];
  onCall = undefined;
});

describe('ИИ-действия: права', () => {
  it('ai_actions пишет только админ проекта; key уникален в проекте', async () => {
    const id = uuidv7();
    expect(
      await w.member.push('ai.action.create', { id, projectId: P, key: 'x', name: 'X' }),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    const dup = await w.admin.push('ai.action.create', {
      id,
      projectId: P,
      key: (await one(`select key from ai_actions where id = $1`, [actionId])).key,
      name: 'X',
    });
    expect(dup).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(await w.member.push('ai.action.update', { id: actionId, name: 'Y' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });

  it('правило с ai_run — только админ; действие другого проекта — отказ', async () => {
    const t = { type: 'task.status_changed', to: [S.backlog] };
    const a = [{ type: 'ai_run', aiActionId: actionId }];
    expect((await rule(t, a, w.member)).r).toMatchObject({ ok: false, code: 'forbidden' });
    const { id, r } = await rule(t, a);
    expect(r).toMatchObject({ ok: true });
    expect(await w.member.push('automations.update', { id, name: 'Z' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(await w.member.push('automations.delete', { id })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    const mine = P;
    const other = await project();
    P = mine;
    const foreign = await w.admin.push('automations.create', {
      id: uuidv7(),
      projectId: other,
      name: 'X',
      trigger: t,
      actions: a,
    });
    expect(foreign).toMatchObject({ ok: false, code: 'invalid_args' });
    // a rule without ai_run stays a member's business
    const plain = await w.member.push('automations.create', {
      id: uuidv7(),
      projectId: P,
      name: 'X',
      trigger: t,
      actions: [{ type: 'add_comment', text: 'hi' }],
    });
    expect(plain).toMatchObject({ ok: true });
  });
});

describe('прогон по правилу', () => {
  const plan = () =>
    rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId },
    ]);

  it('ai_run ставится с debounce по (задача, действие); без ИИ в исполнителях — не идёт', async () => {
    await plan();
    const t = await task();
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await handler('automations', 'automations.run')(jobs.shift()!.data, api);
    expect(jobs).toEqual([
      {
        queue: 'ai.run',
        data: expect.objectContaining({ kind: 'action', taskId: t, actionId, statusId: S.backlog }),
        opts: { singletonKey: `${t}:${actionId}`, upsert: true, startAfter: 10 },
      },
    ]);
    // the AI was unassigned while the job waited: nothing runs
    await w.admin.ok('task.unassign', { taskId: t, userId: bot });
    await drain();
    expect(calls).toHaveLength(0);
    expect(await runsOf(t)).toHaveLength(0);
  });

  it('вопрос → «Уточнение» → ответы в тредах → возврат статуса → новый прогон с планом', async () => {
    await plan();
    const t = await task();
    answers = [
      result({ verdict: 'question', comment: 'Нужны детали', questions: ['Бюджет?', 'Сроки?'] }),
      result({
        comment: 'План готов',
        descriptionAppend: '1. Собрать требования\n2. Внедрить',
        moveTo: 'todo',
      }),
    ];
    process.env.PUBLIC_URL = 'https://kb.example';
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    // the knowledge block (KB-12)
    expect(calls[0]!.system).toContain('Planar knowledge');
    expect(calls[0]!.system).toContain(
      appUrl('https://kb.example', { kind: 'task', key: '<KEY>' }),
    );
    expect(calls[0]!.system).not.toContain('poprygun');
    // the prompt: the instruction from the docs page, the checks, the task
    expect(calls[0]!.system).toContain('Проверь задачу и составь план.');
    expect(calls[0]!.system).toContain('план конечен');
    expect(calls[0]!.prompt).toContain('Сделать CRM');
    expect((await taskRow(t)).status_id).toBe(S.clarify);
    const [run] = await runsOf(t);
    expect(run).toMatchObject({
      state: 'waiting_human',
      return_status_id: S.backlog,
      chain_depth: 0,
    });
    expect(run!.input_tokens).toBe(1000);
    expect(run!.cost).toBeCloseTo(0.002);
    const qs = (await commentsOf(t)).filter((c) => c.assignee_id === w.member.userId);
    expect(qs.map((c) => text(c.body))).toEqual([
      expect.stringContaining('Бюджет?'),
      expect.stringContaining('Сроки?'),
    ]);
    expect(qs.every((c) => c.author_id === bot)).toBe(true);
    expect(run!.question_comment_ids).toEqual(qs.map((c) => c.id));

    // an answer by someone who is not the question's assignee closes nothing
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: qs[0]!.id,
      body: doc('?'),
    });
    expect(
      (await one(`select resolved_at from comments where id = $1`, [qs[0]!.id])).resolved_at,
    ).toBeNull();
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: qs[0]!.id,
      body: doc('1,2 млн'),
    });
    expect(
      (await one(`select resolved_at from comments where id = $1`, [qs[0]!.id])).resolved_at,
    ).not.toBeNull();
    expect((await runsOf(t))[0]!.state).toBe('waiting_human');
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: qs[1]!.id,
      body: doc('квартал'),
    });
    expect((await runsOf(t))[0]!.state).toBe('done');
    // a second answer changes nothing: the run is already resumed once
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: qs[1]!.id,
      body: doc('ещё'),
    });
    expect(jobs.filter((j) => j.data.kind === 'resume')).toHaveLength(1);

    await drain();
    // back to «Backlog» by the bot → the rule → a run of the same chain, with the plan in the description
    expect(calls).toHaveLength(2);
    const runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ state: 'done', chain_id: runs[0]!.id, chain_depth: 1 });
    const row = await taskRow(t);
    expect(row.status_id).toBe(S.todo);
    expect(text(row.description)).toContain(PLAN_HEADING);
    expect(text(row.description)).toContain('Собрать требования');
  });

  it('ручной перенос из «Уточнения» не затирается ответом', async () => {
    await plan();
    const t = await task();
    answers = [result({ verdict: 'question', questions: ['Кто ЛПР?'] })];
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    await w.admin.ok('task.update', { id: t, statusId: S.done });
    const [q] = (await commentsOf(t)).filter((c) => c.assignee_id === w.member.userId);
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: q!.id,
      body: doc('финдир'),
    });
    await drain();
    expect((await taskRow(t)).status_id).toBe(S.done);
    expect(calls).toHaveLength(1);
  });

  it('PLNRAPP-763: вопрос подзадачи без людей — человеку родителя, прогон ждёт ответа', async () => {
    // the parent: created by admin, no assignees; the subtask of the AI — no people of its own
    const parent = await task({ assignees: [] });
    const t = await task({ parentId: parent, assignees: [{ id: uuidv7(), userId: bot }] });
    await raw(`update tasks set created_by = $1 where id = $2`, [bot, t]);
    answers = [result({ verdict: 'question', questions: ['Бюджет?'] })];
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
    const [run] = await runsOf(t);
    expect(run!.state).toBe('waiting_human');
    expect(run!.log).not.toContain('Некому задать вопрос');
    const q = (await commentsOf(t)).find((c) => text(c.body).includes('Бюджет?'));
    expect(q!.assignee_id).toBe(w.admin.userId);
  });

  it('PLNRAPP-763: людей нет и в предках — админу проекта, при исполнителе по умолчанию — ему', async () => {
    const ask = async () => {
      const t = await task({ assignees: [{ id: uuidv7(), userId: bot }] });
      await raw(`update tasks set created_by = $1 where id = $2`, [bot, t]);
      answers = [result({ verdict: 'question', questions: ['Бюджет?'] })];
      await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
      expect((await runsOf(t))[0]!.state).toBe('waiting_human');
      return (await commentsOf(t)).find((c) => text(c.body).includes('Бюджет?'))!.assignee_id;
    };
    // the project inherits the space: its admin is the space admin
    expect(await ask()).toBe(w.admin.userId);
    await w.admin.ok('project.update', { id: P, defaultAssigneeId: w.member.userId });
    expect(await ask()).toBe(w.member.userId);
  });

  it('docs[]: страница под корнем (корень создаётся), повтор переписывает её; связь с задачей', async () => {
    const t = await task();
    const page = (title: string, md: string) =>
      result({ docs: [{ parent: 'Сводки воронок', title, markdown: md }] });
    answers = [page('Неделя 46', 'старое'), page('Неделя 46', 'новое')];
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
    const pages = await raw(
      `select c.id, c.text from docs_pages c join docs_pages r on r.id = c.parent_id
       where r.project_id = $1 and r.title = 'Сводки воронок' and r.parent_id is null`,
      [P],
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]!.text).toContain('новое');
    expect(
      await raw(`select 1 from docs_task_links where page_id = $1`, [pages[0]!.id]),
    ).toHaveLength(1);
  });

  it('read-modify-write: свой блок заменяется, текст людей и следующие разделы целы', async () => {
    await plan();
    const desc = markdownToDoc(
      `Текст человека\n\n## ${PLAN_HEADING}\n\nстарый план\n\n## Заметки\n\nне трогать`,
    );
    const t = await task({ description: desc });
    answers = [result({ descriptionAppend: 'новый план' })];
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    const d = text((await taskRow(t)).description);
    expect(d).toContain('Текст человека');
    expect(d).toContain('новый план');
    expect(d).not.toContain('старый план');
    expect(d).toContain('не трогать');
    expect(d.indexOf('новый план')).toBeLessThan(d.indexOf('Заметки'));
  });

  it('имена — только этого проекта: чужой статус и неизвестная метка отброшены в лог', async () => {
    await plan();
    await w.admin.ok('label.create', {
      id: uuidv7(),
      projectId: P,
      name: 'Горячий',
      color: '#f00',
    });
    const t = await task();
    answers = [
      result({
        moveTo: 'Нет такого',
        labels: ['горячий', 'Чужая'],
        newTasks: [
          ...[
            { title: 'Подзадача', description: null, status: null },
            { title: 'Исправление', description: null, status: 'Отложено' },
            { title: 'Мимо', description: null, status: 'Нет статуса' },
          ].map((n) => ({ ...n, ai: false, after: [], checks: [] })),
        ],
      }),
    ];
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    expect((await taskRow(t)).status_id).toBe(S.backlog);
    expect(await raw(`select 1 from task_labels where task_id = $1`, [t])).toHaveLength(1);
    expect(
      await raw(`select title, status_id from tasks where parent_id = $1 order by rank`, [t]),
    ).toEqual([
      { title: 'Подзадача', status_id: S.todo },
      { title: 'Исправление', status_id: S.snoozed },
      { title: 'Мимо', status_id: S.todo },
    ]);
    const log = (await runsOf(t))[0]!.log as string;
    expect(log).toContain('Нет статуса');
    expect(log).toContain('Нет такого');
    expect(log).toContain('Чужая');
  });

  it('PLNRAPP-204: «Ждёт ответа» — правила по «Уточнению», labels ставит при вопросе и снимает «-Имя»', async () => {
    await plan();
    const waiting = uuidv7();
    await w.admin.ok('label.create', {
      id: waiting,
      projectId: P,
      name: 'Ждёт ответа',
      color: '#f00',
    });
    // the state rules of the packs: in «Уточнение» — the label, out of it — off; an answer closes the question
    await rule({ type: 'task.status_changed', to: [S.clarify] }, [
      { type: 'add_label', labelId: waiting },
    ]);
    await rule({ type: 'task.status_changed', from: [S.clarify] }, [
      { type: 'remove_label', labelId: waiting },
    ]);
    await rule({ type: 'comment.added', byHuman: true }, [{ type: 'resolve_comment' }]);
    const labels = async (t: string) =>
      (await raw(`select label_id from task_labels where task_id = $1`, [t])).map(
        (x) => x.label_id,
      );
    const t = await task();
    answers = [
      result({ verdict: 'question', questions: ['Бюджет?'], labels: ['Ждёт ответа'] }),
      result({ comment: 'План готов', moveTo: 'todo', labels: ['-ждёт ответа'] }),
    ];
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    expect((await taskRow(t)).status_id).toBe(S.clarify);
    expect(await labels(t)).toEqual([waiting]);
    const [q] = (await commentsOf(t)).filter((c) => c.assignee_id === w.member.userId);
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: q!.id,
      body: doc('1 млн'),
    });
    await drain();
    expect(
      (await one(`select resolved_at from comments where id = $1`, [q!.id])).resolved_at,
    ).not.toBeNull();
    expect(calls).toHaveLength(2);
    expect((await taskRow(t)).status_id).toBe(S.todo);
    expect(await labels(t)).toEqual([]);

    // labels of the result alone: «-Имя» removes, a question sets
    const t2 = await task({ labels: [{ id: uuidv7(), labelId: waiting }] });
    answers = [result({ labels: ['-Ждёт ответа'] })];
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t2, actionId }, api);
    expect(await labels(t2)).toEqual([]);
    answers = [result({ verdict: 'question', questions: ['Сроки?'], labels: ['Ждёт ответа'] })];
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t2, actionId }, api);
    expect(await labels(t2)).toEqual([waiting]);
    expect(calls.at(-1)!.system).toContain('«-Имя» — снять');
  });

  it('snoozeUntil → дата начала и «Отложено»; escalate → руководитель упомянут и наблюдает', async () => {
    await w.admin.ok('project.update', { id: P, leadId: w.admin.userId });
    await plan();
    const t = await task();
    answers = [result({ snoozeUntil: '2027-02-01', escalate: 'скидка 30%' })];
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    const row = await taskRow(t);
    expect(row).toMatchObject({ status_id: S.snoozed });
    expect(String(row.start_date)).toContain('2027');
    const esc = (await commentsOf(t)).find((c) => text(c.body).includes('скидка 30%'))!;
    expect(esc.mentions).toEqual([w.admin.userId]);
    expect(
      await raw(`select 1 from task_watchers where task_id = $1 and user_id = $2`, [
        t,
        w.admin.userId,
      ]),
    ).toHaveLength(1);
  });

  it('PLNRAPP-452: в схеме ответа — база и поля из инструкции; остальные — оглавлением need, по запросу', async () => {
    const base = [
      'verdict',
      'comment',
      'questions',
      'descriptionAppend',
      'moveTo',
      'labels',
      'friction',
      'uncertain',
    ];
    // the checks name snoozeUntil: it is in the schema at once, one request
    actionId = await action({ checks: ['срок — в snoozeUntil'] });
    await plan();
    const t = await task();
    schemas = [];
    answers = [result({ snoozeUntil: '2027-02-01' })];
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    expect(schemas.filter((s) => s.includes('comment'))).toHaveLength(1);
    expect(schemas[0]!.sort()).toEqual([...base, 'snoozeUntil', 'need'].sort());
    expect(calls[0]!.system).toContain('snoozeUntil — отложить задачу до даты YYYY-MM-DD');
    // the fields outside the schema — one line each in need, without their descriptions
    expect(calls[0]!.system).toContain('docs — создать или переписать документ проекта;');
    expect(calls[0]!.system).not.toContain('сам ничего не отправляй');
    expect((await taskRow(t)).status_id).toBe(S.snoozed);

    // the model asks for escalate through need: the request is repeated with it, the tokens add up
    await w.admin.ok('project.update', { id: P, leadId: w.admin.userId });
    const t2 = await task();
    schemas = [];
    calls = [];
    answers = [result({ comment: '', need: ['escalate'] }), result({ escalate: 'скидка 30%' })];
    await w.admin.ok('task.update', { id: t2, statusId: S.backlog });
    await drain();
    expect(calls).toHaveLength(2);
    expect(schemas[1]!.sort()).toEqual([...base, 'snoozeUntil', 'escalate'].sort());
    expect(calls[1]!.system).toContain('escalate — причина');
    expect(calls[1]!.system).not.toContain('need');
    const [run] = await runsOf(t2);
    // both requests and the engine's LLM check, 1000 each
    expect(run!.input_tokens).toBe(3000);
    expect(run!.log).toContain('запрошены поля результата: escalate');
    expect((await commentsOf(t2)).some((c) => text(c.body).includes('скидка 30%'))).toBe(true);
  });

  it('отменённый прогон не применяется; новый прогон отменяет прежний той же пары', async () => {
    await plan();
    const t = await task();
    onCall = async () => {
      await raw(`update ai_runs set state = 'cancelled' where task_id = $1`, [t]);
    };
    answers = [result({ comment: 'не должно появиться', moveTo: 'todo' })];
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
    expect((await runsOf(t))[0]!.state).toBe('cancelled');
    expect((await commentsOf(t)).filter((c) => c.author_id === bot)).toHaveLength(0);
    expect((await taskRow(t)).status_id).toBe(S.backlog);

    onCall = undefined;
    await raw(`update ai_runs set state = 'running' where task_id = $1`, [t]);
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
    const runs = await runsOf(t);
    expect(runs.map((r) => r.state)).toEqual(['cancelled', 'done']);
  });

  it(`цепочка длиннее ${MAX_CHAIN} останавливается с комментарием`, async () => {
    const t = await task();
    const parent = uuidv7();
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth)
       values ($1, $2, $3, 'action', $4, 'done', $1, $5)`,
      [parent, t, P, actionId, MAX_CHAIN],
    );
    await handler('ai', 'ai.run')(
      { kind: 'action', taskId: t, actionId, parentRunId: parent },
      api,
    );
    expect(calls).toHaveLength(0);
    const runs = await runsOf(t);
    expect(runs[1]).toMatchObject({ state: 'failed', chain_depth: MAX_CHAIN + 1 });
    expect(text((await commentsOf(t)).at(-1)!.body)).toContain('цепочка');
  });

  it('бюджет задачи исчерпан → вопрос «продлить?» без вызова провайдера', async () => {
    const f = uuidv7();
    await w.admin.ok('field.create', {
      id: f,
      projectId: P,
      name: 'Бюджет',
      type: 'number',
      rank: 'a0',
    });
    const t = await task();
    await w.admin.ok('task.setField', { taskId: t, fieldId: f, value: 1 });
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth, cost)
       values ($1, $2, $3, 'action', 'done', $1, 0, 1.5)`,
      [uuidv7(), t, P],
    );
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
    expect(calls).toHaveLength(0);
    expect((await runsOf(t)).at(-1)!.state).toBe('waiting_human');
    expect((await taskRow(t)).status_id).toBe(S.clarify);
    const q = (await commentsOf(t)).at(-1)!;
    expect(q.assignee_id).toBe(w.member.userId);
    expect(text(q.body)).toContain('Продлить');
  });

  it('PLNRAPP-205: maxRuns — прогонов правила подряд не больше N, дальше вопрос человеку; прогон не по правилу сбрасывает счёт', async () => {
    const { id: ruleId } = await rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId, maxRuns: 2 },
    ]);
    const t = await task({ statusId: S.backlog });
    const prior = (r: string | null) =>
      raw(
        `insert into ai_runs (id, task_id, project_id, kind, action_id, rule_id, state, chain_id, chain_depth)
         values ($1, $2, $3, 'action', $4, $5, 'done', $1, 0)`,
        [uuidv7(), t, P, actionId, r],
      );
    await prior(ruleId);
    await prior(null); // a run not by this rule: the count starts over
    await prior(ruleId);
    const start = () =>
      handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId, ruleId }, api);
    await start();
    expect(calls).toHaveLength(1);
    expect((await runsOf(t)).at(-1)!.state).toBe('done');
    // two runs by the rule in a row — the limit: a question to the person, no provider call
    await start();
    expect(calls).toHaveLength(1);
    expect((await runsOf(t)).at(-1)!.state).toBe('waiting_human');
    expect((await taskRow(t)).status_id).toBe(S.clarify);
    const q = (await commentsOf(t)).at(-1)!;
    expect(q.assignee_id).toBe(w.member.userId);
    expect(text(q.body)).toContain('раз подряд');
  });
});

describe('движок: приёмка, доработка, надзор, сверка (PLNRAPP-404)', () => {
  const start = (t: string) =>
    handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
  const botComments = async (t: string) =>
    (await commentsOf(t)).filter((c) => c.author_id === bot).map((c) => text(c.body));

  it('не принято проверкой → изменения не применены, доработка с замечаниями; вторая попытка принята', async () => {
    const t = await task();
    answers = [
      result({ comment: 'первый итог', descriptionAppend: 'план 1' }),
      result({ comment: 'второй итог', descriptionAppend: 'план 2' }),
    ];
    verdicts = [
      { pass: false, failures: ['план не конечен'] },
      { pass: true, failures: [] },
    ];
    await start(t);
    await drain();
    const runs = await runsOf(t);
    expect(runs.map((r) => [r.state, r.attempt])).toEqual([
      ['failed', 1],
      ['done', 2],
    ]);
    expect(runs[0]!.report).toMatchObject({
      failures: ['план не конечен'],
      comment: 'первый итог',
    });
    expect(runs[0]!.log).toContain('движок: результат не принят проверками — попытка 2 из 3');
    expect(runs[1]!.restart_of).toBe(runs[0]!.id);
    expect(runs[1]!.log).toContain('движок: результат принят проверками');
    // the check sees the criteria and the result, the rework — the remarks and the previous outcome
    expect(judged[0]).toContain('план конечен');
    expect(judged[0]).toContain('первый итог');
    expect(calls[1]!.prompt).toContain('Доработка: попытка 2 из 3');
    expect(calls[1]!.prompt).toContain('план не конечен');
    expect(calls[1]!.prompt).toContain('первый итог');
    const bc = await botComments(t);
    expect(bc.join()).not.toContain('первый итог');
    expect(bc.join()).toContain('второй итог');
    const desc = text((await taskRow(t)).description);
    expect(desc).toContain('план 2');
    expect(desc).not.toContain('план 1');
    // the LLM check's tokens add to the run's (the fake answers 1000 input tokens to each call)
    expect(runs[1]!.input_tokens).toBe(2000);
  });

  it('попытки исчерпаны → вопрос человеку с замечаниями, задача в «Уточнении»', async () => {
    await w.admin.ok('ai.action.update', { id: actionId, maxAttempts: 2 });
    const t = await task();
    answers = [result({ comment: 'раз' }), result({ comment: 'два' })];
    verdicts = [
      { pass: false, failures: ['нет оценки'] },
      { pass: false, failures: ['нет сроков'] },
    ];
    await start(t);
    await drain();
    expect(calls).toHaveLength(2);
    const runs = await runsOf(t);
    expect(runs.map((r) => r.state)).toEqual(['failed', 'waiting_human']);
    expect(runs[1]!.report).toMatchObject({ failures: ['нет сроков'] });
    expect((await taskRow(t)).status_id).toBe(S.clarify);
    const q = (await commentsOf(t)).at(-1)!;
    expect(q.assignee_id).toBe(w.member.userId);
    expect(text(q.body)).toContain('нет сроков');
    expect((await botComments(t)).join()).toContain('не принят проверками после 2 попыток');
  });

  it('сомнения без критериев поднимают проверку; «$»-команды в llm пропускаются с записью в журнал', async () => {
    await w.admin.ok('ai.action.update', { id: actionId, checks: ['$ pnpm test'] });
    const t = await task();
    answers = [result({ uncertain: 'не проверил ссылки' })];
    await start(t);
    expect(judged).toHaveLength(1);
    expect(judged[0]).toContain('не проверил ссылки');
    const [run] = await runsOf(t);
    expect(run!.state).toBe('done');
    expect(run!.log).toContain('движок: команды проверок пропущены');
    expect((await botComments(t)).join()).toContain('Сомнения');

    // no checks and no doubts — no check
    await w.admin.ok('ai.action.update', { id: actionId, checks: [] });
    const t2 = await task();
    await start(t2);
    expect(judged).toHaveLength(1);
    expect((await runsOf(t2))[0]!.state).toBe('done');
  });

  it('ошибка провайдера → повтор с паузой 60 с × попытка, без замечаний в промпте', async () => {
    const t = await task();
    answers = ['не JSON по схеме'];
    await start(t);
    const [first] = await runsOf(t);
    expect(first).toMatchObject({ state: 'failed', report: null });
    expect(first!.log).toContain('движок: ошибка провайдера, повтор с паузой — попытка 2 из 3');
    expect(jobs).toEqual([
      expect.objectContaining({
        queue: 'ai.run',
        data: expect.objectContaining({ kind: 'action', restartOf: first!.id }),
        opts: expect.objectContaining({ startAfter: 60 }),
      }),
    ]);
    await drain();
    const runs = await runsOf(t);
    expect(runs.map((r) => [r.state, r.attempt])).toEqual([
      ['failed', 1],
      ['done', 2],
    ]);
    expect(calls[1]!.prompt).not.toContain('Доработка');
  });

  it('ошибка провайдера: в журнале статус и текст провайдера, ключ вырезан', async () => {
    const t = await task();
    answers = [PROVIDER_400];
    await start(t);
    const [first] = await runsOf(t);
    expect(first!.log).toContain('провайдер: AI_APICallError 400 — schema too complex; key ***');
    expect(first!.log).not.toContain('sk-test');
  });

  it('жнец: нет heartbeat → перезапуск в пределах попыток, последняя попытка — failed', async () => {
    await w.admin.ok('ai.action.update', { id: actionId, runtime: 'agent' });
    const t = await task();
    const lost = (attempt: number) => {
      const id = uuidv7();
      return raw(
        `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth, attempt,
           agent_secret_hash, started_at, heartbeat_at)
         values ($1, $2, $3, 'action', $4, 'running', $1, 0, $5, 'x', now() - interval '5 min', now() - interval '5 min')`,
        [id, t, P, actionId, attempt],
      ).then(() => id);
    };
    const reap = () => handler('ai', 'ai.agent.reap')({}, api);
    const a = await lost(1);
    await reap();
    let runs = await runsOf(t);
    expect(runs.map((r) => [r.state, r.attempt, r.restart_of])).toEqual([
      ['failed', 1, null],
      ['queued', 2, a],
    ]);
    expect(runs[0]!.log).toContain('heartbeat');
    expect(jobs.filter((j) => j.queue === 'ai.run')).toHaveLength(1);

    await raw(`delete from ai_runs where task_id = $1`, [t]);
    jobs.length = 0;
    await lost(3);
    await reap();
    runs = await runsOf(t);
    expect(runs.map((r) => r.state)).toEqual(['failed']);
    expect(jobs).toHaveLength(0);
    expect((await botComments(t)).join()).toContain('heartbeat');
  });

  it('жнец: LLM-прогон, прерванный перезапуском, через 30 мин — перезапуск; свежий не трогает', async () => {
    const t = await task();
    const running = (ago: string) => {
      const id = uuidv7();
      return raw(
        `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth, attempt, started_at)
         values ($1, $2, $3, 'action', $4, 'running', $1, 0, 1, now() - $5::interval)`,
        [id, t, P, actionId, ago],
      ).then(() => id);
    };
    const reap = () => handler('ai', 'ai.agent.reap')({}, api);
    await running('5 min');
    await reap();
    expect((await runsOf(t)).map((r) => r.state)).toEqual(['running']);

    await raw(`delete from ai_runs where task_id = $1`, [t]);
    const a = await running('31 min');
    await reap();
    const runs = await runsOf(t);
    expect(runs.map((r) => [r.state, r.attempt, r.restart_of])).toEqual([
      ['failed', 1, null],
      ['queued', 2, a],
    ]);
    expect(runs[0]!.log).toContain('перезапуск сервера');
  });

  it('сверка: задача на ИИ в статусе действия без запуска — в очередь; принятая и активная — нет; упавшая — повтор после паузы', async () => {
    const { id: ruleId } = await rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId },
    ]);
    const t = await task({ statusId: S.backlog });
    // another status, and a task without the AI — not picked
    await task();
    await task({ statusId: S.backlog, assignees: [{ id: uuidv7(), userId: w.member.userId }] });
    jobs.length = 0;
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    await reconcile();
    expect(jobs).toEqual([
      expect.objectContaining({
        queue: 'ai.run',
        data: expect.objectContaining({ kind: 'action', taskId: t, actionId, ruleId }),
      }),
    ]);
    let runs = await runsOf(t);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: 'queued', attempt: 1 });
    expect(runs[0]!.log).toContain('движок: сверка: задача стоит в статусе действия');

    // queued — active: nothing new
    await reconcile();
    expect(jobs).toHaveLength(1);
    await drain();
    expect((await runsOf(t))[0]!.state).toBe('done');
    await reconcile();
    expect(jobs).toHaveLength(0);

    // a failed run: again only after its pause, as attempt + 1
    const id = (await runsOf(t))[0]!.id as string;
    await raw(`update ai_runs set state = 'failed' where id = $1`, [id]);
    await reconcile();
    expect(jobs).toHaveLength(0);
    await raw(`update ai_runs set finished_at = now() - interval '2 min' where id = $1`, [id]);
    await reconcile();
    expect(jobs).toHaveLength(1);
    runs = await runsOf(t);
    expect(runs.at(-1)).toMatchObject({ state: 'queued', attempt: 2, restart_of: id });
  });

  it('сверка: у задачи активный прогон другого действия (триаж ждёт ответа) — действие статуса ждёт его (PLNRAPP-537)', async () => {
    await rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId },
    ]);
    const t = await task({ statusId: S.backlog });
    const other = uuidv7();
    // its question is open in the task (PLNRAPP-741: a waiting run without one is not waiting)
    const q = uuidv7();
    await raw(
      `insert into comments (id, space_id, task_id, author_id, body, assignee_id)
       select $1, space_id, id, $2, '{"type":"doc","content":[]}'::jsonb, $3 from tasks where id = $4`,
      [q, bot, w.member.userId, t],
    );
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth, question_comment_ids)
       values ($1, $2, $3, 'action', 'waiting_human', $1, 0, array[$4::uuid])`,
      [other, t, P, q],
    );
    jobs.length = 0;
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    await reconcile();
    expect(jobs).toHaveLength(0);
    await raw(`update ai_runs set state = 'done' where id = $1`, [other]);
    await reconcile();
    expect(jobs).toEqual([
      expect.objectContaining({
        queue: 'ai.run',
        data: expect.objectContaining({ taskId: t, actionId }),
      }),
    ]);
  });

  it('сверка и правила: задача с открытыми подзадачами их координирует — действие статуса на ней не запускается (PLNRAPP-776)', async () => {
    const { id: ruleId } = await rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId },
    ]);
    const t = await task({ statusId: S.backlog });
    const sub = await task({ parentId: t });
    jobs.length = 0;
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    await reconcile();
    expect(jobs.filter((j) => j.queue === 'ai.run')).toHaveLength(0);
    // the rule's event: no run either
    await handler('ai', 'ai.run')(
      { kind: 'action', taskId: t, actionId, ruleId, statusId: S.backlog },
      api,
    );
    expect(await runsOf(t)).toHaveLength(0);
    // the subtasks are closed — the action of the status goes
    await w.admin.ok('task.update', { id: sub, statusId: S.done });
    jobs.length = 0;
    await reconcile();
    expect(jobs).toEqual([
      expect.objectContaining({
        queue: 'ai.run',
        data: expect.objectContaining({ taskId: t, actionId }),
      }),
    ]);
  });

  it('сверка: задача снова вошла в статус после принятого прогона — запуск заново с попытки 1 (PLNRAPP-656)', async () => {
    await rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId },
    ]);
    const t = await task({ statusId: S.backlog });
    const done = uuidv7();
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth, attempt)
       values ($1, $2, $3, 'action', $4, 'done', $1, 0, 2)`,
      [done, t, P, actionId],
    );
    await raw(`update ai_runs set finished_at = now() - interval '10 min' where id = $1`, [done]);
    const entered = (ago: string) =>
      raw(
        `insert into activity (id, space_id, task_id, actor_id, kind, changes, created_at)
         select $1, space_id, id, $2, 'updated', jsonb_build_object('statusId', jsonb_build_array($3::text, status_id::text)),
           now() - $4::interval from tasks where id = $5`,
        [uuidv7(), w.admin.userId, S.todo, ago, t],
      );
    jobs.length = 0;
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    // the entry before the run's end (the run's own move, the rule that started it) — nothing new
    await entered('20 min');
    await reconcile();
    expect(jobs).toHaveLength(0);
    // back in the status after the run (the test sent it back) — the action again
    await entered('1 min');
    await reconcile();
    expect(jobs).toEqual([
      expect.objectContaining({
        queue: 'ai.run',
        data: expect.objectContaining({ taskId: t, actionId, restartOf: null }),
      }),
    ]);
    const last = (await runsOf(t)).at(-1)!;
    expect(last).toMatchObject({ state: 'queued', attempt: 1, restart_of: null });
    expect(last.log).toContain('сверка: задача снова в статусе действия');
  });

  it('сверка: задача создана сразу в статусе правила — сначала действия правила (set_status, метка), прогон — в статусе после них; «после ответа» не срабатывает (PLNRAPP-837)', async () => {
    const inProgress = await status('В работе', 'in_progress');
    const label = uuidv7();
    await w.admin.ok('label.create', { id: label, projectId: P, name: 'ИИ', color: '#0f0' });
    const { id: ruleId } = await rule({ type: 'task.status_changed', to: [S.todo] }, [
      { type: 'set_status', statusId: inProgress },
      { type: 'add_label', labelId: label },
      { type: 'ai_run', aiActionId: actionId },
    ]);
    // «Разработка после ответа»: only out of «Уточнение»
    const { id: afterAnswer } = await rule(
      { type: 'task.status_changed', from: [S.clarify], to: [inProgress] },
      [{ type: 'ai_run', aiActionId: actionId }],
    );
    const t = await task();
    const moves = () =>
      raw(
        `select changes->'statusId' as s from activity where task_id = $1 and kind = 'updated' and changes ? 'statusId'`,
        [t],
      ).then((r) => r.map((x) => x.s));
    jobs.length = 0;
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    await reconcile();
    expect((await taskRow(t)).status_id).toBe(inProgress);
    expect(await moves()).toEqual([[S.todo, inProgress]]);
    expect(
      (await raw(`select label_id from task_labels where task_id = $1`, [t])).map(
        (r) => r.label_id,
      ),
    ).toEqual([label]);
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ taskId: t, actionId, ruleId, statusId: inProgress }),
      }),
    ]);
    expect(
      jobs.filter((j) => j.queue === 'automations.run' && j.data.ruleId === afterAnswer),
    ).toHaveLength(0);
    expect(
      await raw(`select status from automations_runs where rule_id = $1 and task_id = $2`, [
        ruleId,
        t,
      ]),
    ).toEqual([{ status: 'ok' }]);
    await drain();
    let runs = await runsOf(t);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: 'done', rule_id: ruleId });
    // the rule's move is no new entry: nothing more
    jobs.length = 0;
    await reconcile();
    expect(jobs.filter((j) => j.queue === 'ai.run')).toHaveLength(0);

    // a retry of the failed run (in «В работе»): no new status change, one run queued
    const id = runs[0]!.id as string;
    await raw(
      `update ai_runs set state = 'failed', finished_at = now() - interval '2 min' where id = $1`,
      [id],
    );
    jobs.length = 0;
    await reconcile();
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ taskId: t, actionId, restartOf: id, statusId: inProgress }),
      }),
    ]);
    expect(await moves()).toHaveLength(1);
    runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ state: 'queued', attempt: 2, restart_of: id });
  });

  it('сверка: повтор упавшего прогона не повторяет действия правила — статус не меняется (PLNRAPP-837)', async () => {
    const inProgress = await status('В работе', 'in_progress');
    const { id: ruleId } = await rule({ type: 'task.status_changed', to: [S.todo] }, [
      { type: 'set_status', statusId: inProgress },
      { type: 'ai_run', aiActionId: actionId },
    ]);
    const t = await task();
    const failed = uuidv7();
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, rule_id, state, chain_id, chain_depth, attempt, finished_at)
       values ($1, $2, $3, 'action', $4, $5, 'failed', $1, 0, 1, now() - interval '2 min')`,
      [failed, t, P, actionId, ruleId],
    );
    jobs.length = 0;
    await handler('ai', 'ai.engine.reconcile')({}, api);
    expect((await taskRow(t)).status_id).toBe(S.todo);
    expect(
      await raw(
        `select 1 from activity where task_id = $1 and kind = 'updated' and changes ? 'statusId'`,
        [t],
      ),
    ).toHaveLength(0);
    expect(jobs).toEqual([
      expect.objectContaining({
        queue: 'ai.run',
        data: expect.objectContaining({ taskId: t, restartOf: failed, statusId: S.todo }),
      }),
    ]);
  });

  it('сторож: задача на ИИ без прогона и движения — ошибка в логе монитора и один комментарий на вход в статус (PLNRAPP-657)', async () => {
    await w.admin.ok('project.update', { id: P, leadId: w.admin.userId });
    const inProgress = await status('В работе', 'in_progress');
    const stuck = await task({ statusId: inProgress });
    // waits for an answer (an open question in the question status) and works (an active run) — not stuck
    const asked = await task({ statusId: S.clarify });
    await raw(
      `insert into comments (id, space_id, task_id, author_id, assignee_id, body)
       select $1, space_id, id, $2, $3, '{"type":"doc","content":[]}'::jsonb from tasks where id = $4`,
      [uuidv7(), bot, w.member.userId, asked],
    );
    const busy = await task({ statusId: inProgress });
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth)
       values ($1, $2, $3, 'action', 'running', $1, 0)`,
      [uuidv7(), busy, P],
    );
    const age = (t: string) =>
      Promise.all([
        raw(`update tasks set created_at = now() - interval '3 hours' where id = $1`, [t]),
        raw(`update activity set created_at = now() - interval '3 hours' where task_id = $1`, [t]),
      ]);
    for (const t of [stuck, asked, busy]) await age(t);
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    const errors = async () =>
      (
        await raw(`select text from ai_engine_events where task_id = $1 and level = 'error'`, [
          stuck,
        ])
      ).map((e) => e.text as string);
    const watch = async (t: string) =>
      (await commentsOf(t)).filter((c) => c.author_id === bot && text(c.body).includes('Сторож'));

    jobs.length = 0;
    await reconcile();
    expect(await errors()).toEqual([expect.stringMatching(/^сторож: .+ стоит в «В работе» 3 ч/)]);
    const [c] = await watch(stuck);
    // PLNRAPP-773: the handoff to the AI calls no one
    expect(text(c!.body)).not.toContain('"mention"');
    expect(await watch(asked)).toEqual([]);
    expect(await watch(busy)).toEqual([]);
    // PLNRAPP-764: the stall goes to the AI — a run on the watchdog's comment as the assignment
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'mention', taskId: stuck, itemId: c!.id }),
      }),
    ]);
    expect((await runsOf(stuck)).map((r) => r.state)).toEqual(['queued']);

    // the AI's run ended and the task is still stuck — a question to the task's person, no second run (PLNRAPP-740)
    await raw(`update ai_runs set state = 'done' where task_id = $1`, [stuck]);
    await age(stuck);
    jobs.length = 0;
    await reconcile();
    expect(await errors()).toHaveLength(2);
    const [, asks] = await watch(stuck);
    expect(asks!.assignee_id).toBe(w.member.userId);
    expect(text(asks!.body)).toContain('Нужно решение человека');
    expect((await taskRow(stuck)).status_id).toBe(S.clarify);
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([]);

    // waits for the answer in the question status — no third comment
    await age(stuck);
    await reconcile();
    expect(await watch(stuck)).toHaveLength(2);

    // PLNRAPP-773: the answer returns the task to its status, its rule goes on
    expect((await runsOf(stuck)).at(-1)).toMatchObject({
      state: 'waiting_human',
      return_status_id: inProgress,
      question_comment_ids: [asks!.id],
    });
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: stuck,
      parentId: asks!.id,
      body: doc('Продолжай по плану'),
    });
    expect((await runsOf(stuck)).at(-1)!.state).toBe('done');
    await drain();
    expect((await taskRow(stuck)).status_id).toBe(inProgress);
  });

  it('сторож: затык — действию «Разбор затыка», его прогон видит прогоны ИИ задачи; решение — в логе монитора (PLNRAPP-774)', async () => {
    const unstick = await action({ key: 'unstick', name: 'Разбор затыка', checks: [] });
    const inProgress = await status('В работе', 'in_progress');
    const t = await task({ statusId: inProgress });
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, attempt, chain_id, chain_depth, report, log)
       values ($1, $2, $3, 'action', $4, 'failed', 3, $1, 0, '{"failures":["MR не открыт"]}'::jsonb, 'agent: glab: 401 Unauthorized\n')`,
      [uuidv7(), t, P, actionId],
    );
    await raw(`update tasks set created_at = now() - interval '3 hours' where id = $1`, [t]);
    await raw(`update activity set created_at = now() - interval '3 hours' where task_id = $1`, [
      t,
    ]);
    jobs.length = 0;
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    await reconcile();
    expect(jobs.filter((j) => j.queue === 'ai.run').map((j) => j.data)).toEqual([
      expect.objectContaining({ kind: 'action', taskId: t, actionId: unstick }),
    ]);
    answers = [result({ comment: 'Токен GitLab обновлён — повтор разработки', moveTo: 'todo' })];
    await drain();
    const prompt = calls.at(-1)!.prompt;
    expect(prompt).toContain('## Прогоны ИИ');
    expect(prompt).toMatch(
      /Планирование — ошибка, попытка 3\. Замечания: MR не открыт\. Журнал: …agent: glab: 401/,
    );
    expect((await taskRow(t)).status_id).toBe(S.todo);
    await reconcile();
    await reconcile();
    const lines = (
      await raw(`select text from ai_engine_events where task_id = $1 and text like '%разбора%'`, [
        t,
      ])
    ).map((e) => e.text as string);
    expect(lines, JSON.stringify(lines)).toEqual([
      expect.stringMatching(
        /решение разбора затыка: задача переведена в «.+», работу продолжит правило статуса$/,
      ),
    ]);
  });

  it('сторож: старая жалоба без прогона ИИ — сначала разбор ИИ, а не вопрос человеку (PLNRAPP-773)', async () => {
    const inProgress = await status('В работе', 'in_progress');
    const t = await task({ statusId: inProgress });
    await raw(
      `insert into comments (id, space_id, task_id, author_id, body)
       select $1, space_id, id, $2, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Сторож движка ИИ: жалоба"}]}]}'::jsonb
       from tasks where id = $3`,
      [uuidv7(), bot, t],
    );
    await raw(`update tasks set created_at = now() - interval '3 hours' where id = $1`, [t]);
    await raw(`update activity set created_at = now() - interval '3 hours' where task_id = $1`, [
      t,
    ]);
    await raw(`update comments set created_at = now() - interval '2 hours' where task_id = $1`, [
      t,
    ]);
    jobs.length = 0;
    await handler('ai', 'ai.engine.reconcile')({}, api);
    expect(jobs.filter((j) => j.queue === 'ai.run').map((j) => j.data)).toEqual([
      expect.objectContaining({ kind: 'mention', taskId: t }),
    ]);
    expect((await taskRow(t)).status_id).toBe(inProgress);
  });

  it('сверка: вопрос закрыт человеком без ответа — решение продолжать, задача возвращается в работу (PLNRAPP-773)', async () => {
    const inProgress = await status('В работе', 'in_progress');
    const t = await task({ statusId: S.clarify });
    const q = uuidv7();
    await raw(
      `insert into comments (id, space_id, task_id, author_id, assignee_id, body, resolved_at, resolved_by)
       select $1, space_id, id, $2, $3, '{"type":"doc","content":[]}'::jsonb, now(), $3 from tasks where id = $4`,
      [q, bot, w.member.userId, t],
    );
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth,
         return_status_id, question_comment_ids)
       values ($1, $2, $3, 'action', $4, 'waiting_human', $1, 0, $5, array[$6::uuid])`,
      [uuidv7(), t, P, actionId, inProgress, q],
    );
    jobs.length = 0;
    await handler('ai', 'ai.engine.reconcile')({}, api);
    expect((await runsOf(t)).map((r) => r.state)).toEqual(['done']);
    await drain();
    expect((await taskRow(t)).status_id).toBe(inProgress);
  });

  it('сторож: задача в «Уточнении» без открытого вопроса (подзадача ИИ) — затык, передаётся ИИ (PLNRAPP-773)', async () => {
    const parent = await task();
    const t = await task({ statusId: S.clarify, parentId: parent });
    for (const x of [parent, t]) {
      await raw(`update tasks set created_at = now() - interval '3 hours' where id = $1`, [x]);
      await raw(`update activity set created_at = now() - interval '3 hours' where task_id = $1`, [
        x,
      ]);
    }
    jobs.length = 0;
    await handler('ai', 'ai.engine.reconcile')({}, api);
    expect(jobs.filter((j) => j.queue === 'ai.run').map((j) => j.data)).toEqual([
      expect.objectContaining({ kind: 'mention', taskId: t }),
    ]);
  });

  it('сверка: на вопросы ответили, а задача не вернулась (хук или возврат потерян) — возврат без человека (PLNRAPP-773)', async () => {
    const inProgress = await status('В работе', 'in_progress');
    const question = async (t: string) => {
      const id = uuidv7();
      await raw(
        `insert into comments (id, space_id, task_id, author_id, assignee_id, body, resolved_at)
         select $1, space_id, id, $2, $3, '{"type":"doc","content":[]}'::jsonb, now() from tasks where id = $4`,
        [id, bot, w.member.userId, t],
      );
      await raw(
        `insert into comments (id, space_id, task_id, author_id, parent_id, body)
         select $1, space_id, id, $2, $3, '{"type":"doc","content":[]}'::jsonb from tasks where id = $4`,
        [uuidv7(), w.member.userId, id, t],
      );
      return id;
    };
    // the hook missed the answer: the run still waits
    const missed = await task({ statusId: S.clarify });
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth,
         return_status_id, question_comment_ids)
       values ($1, $2, $3, 'action', $4, 'waiting_human', $1, 0, $5, array[$6::uuid])`,
      [uuidv7(), missed, P, actionId, inProgress, await question(missed)],
    );
    // the resume was lost: the run is done, the task is still in the question status
    const lost = await task({ statusId: S.clarify });
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth,
         return_status_id, question_comment_ids, updated_at)
       values ($1, $2, $3, 'action', $4, 'done', $1, 0, $5, array[$6::uuid], now() - interval '10 minutes')`,
      [uuidv7(), lost, P, actionId, inProgress, await question(lost)],
    );
    jobs.length = 0;
    await handler('ai', 'ai.engine.reconcile')({}, api);
    expect((await runsOf(missed))[0]!.state).toBe('done');
    await drain();
    expect((await taskRow(missed)).status_id).toBe(inProgress);
    expect((await taskRow(lost)).status_id).toBe(inProgress);
  });

  it('сторож: задача, которая ждёт чужую работу (блокер, подзадача, конвейер MR), не застряла (PLNRAPP-740)', async () => {
    const inProgress = await status('В работе', 'in_progress');
    const blocker = await task({ assignees: [] });
    const blocked = await task({ statusId: inProgress });
    await raw(
      `insert into task_links (id, space_id, task_id, target_id, kind, created_by)
       select $1, space_id, $2, $3, 'blocks', $4 from tasks where id = $2`,
      [uuidv7(), blocker, blocked, w.admin.userId],
    );
    const parent = await task({ statusId: inProgress });
    await task({ parentId: parent, assignees: [] });
    const merging = await task({ statusId: inProgress });
    await raw(
      `insert into gitlab_mrs (id, space_id, task_id, gitlab_project_id, iid, title, source_branch, state,
         author_name, web_url, mr_updated_at, pipeline_status, created_at, updated_at)
       select $1, space_id, id, 1, 1, 'MR', 'mr/x', 'opened', 'dev', 'https://gl/x', now(), 'running', now(), now()
       from tasks where id = $2`,
      [uuidv7(), merging],
    );
    const all = [blocker, blocked, parent, merging];
    await raw(
      `update tasks set created_at = now() - interval '3 hours' where id = any($1::uuid[])`,
      [all],
    );
    await raw(
      `update activity set created_at = now() - interval '3 hours' where task_id = any($1::uuid[])`,
      [all],
    );
    await handler('ai', 'ai.engine.reconcile')({}, api);
    const errors = await raw(
      `select task_id from ai_engine_events where level = 'error' and task_id = any($1::uuid[])`,
      [[blocked, parent, merging]],
    );
    expect(errors).toEqual([]);
  });

  it('PLNRAPP-740: вопрос без вопросов и комментария — явная ошибка, изменения не применены', async () => {
    const t = await task();
    answers = [
      result({
        verdict: 'question',
        comment: '',
        questions: [],
        descriptionAppend: 'Не применять',
      }),
    ];
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
    const [run] = await runsOf(t);
    expect(run!.state).toBe('failed');
    expect(run!.log).toContain('без вопросов и комментария');
    expect(run!.question_comment_ids).toEqual([]);
    expect((await commentsOf(t)).map((c) => text(c.body))).toEqual([
      expect.stringContaining('Прогон завершился ошибкой'),
    ]);
    const row = await taskRow(t);
    expect(text(row.description)).not.toContain('Не применять');
    expect(row.status_id).toBe(S.todo);
  });

  it('PLNRAPP-740: вопрос, который не удалось опубликовать, — ошибка с причиной, вопросов нет', async () => {
    const t = await task();
    // the question status of another project: the move is rejected, the batch rolls back
    const other = await project();
    await raw(
      `update ai_actions set question_status_id = (select id from statuses where project_id = $1 limit 1)
       where id = $2`,
      [other, actionId],
    );
    answers = [result({ verdict: 'question', comment: 'Нужны детали', questions: ['Бюджет?'] })];
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
    const [run] = await runsOf(t);
    expect(run!.state).toBe('failed');
    expect(run!.question_comment_ids).toEqual([]);
    expect(run!.log).toContain('не применено');
    expect((await commentsOf(t)).map((c) => text(c.body))).toEqual([
      expect.stringContaining('Изменения не применены'),
    ]);
    expect((await taskRow(t)).status_id).toBe(S.todo);
  });

  it('PLNRAPP-741: прогон сообщил о вопросе, а вопроса в задаче нет — сверка перезапускает ограниченно и останавливает с причиной', async () => {
    await w.admin.ok('ai.action.update', { id: actionId, maxAttempts: 2 });
    const t = await task();
    // a run whose question is open — waits as it should, the reconcile leaves it alone
    const fine = await task();
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    const ask = async (id: string) => {
      answers = [result({ verdict: 'question', comment: '', questions: ['Бюджет?'] })];
      await handler('ai', 'ai.run')({ kind: 'action', taskId: id, actionId }, api);
    };
    await ask(fine);
    await ask(t);
    let [run] = await runsOf(t);
    expect(run!.state).toBe('waiting_human');
    // the question is gone from the task: no answer can come
    const lose = () =>
      raw(
        `delete from comments where id in (select unnest(question_comment_ids) from ai_runs where task_id = $1)`,
        [t],
      );
    await lose();
    jobs.length = 0;
    await reconcile();
    let runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.state).toBe('failed');
    expect(runs[0]!.log).toContain('открытого вопроса в задаче нет');
    expect(runs[0]!.log).toContain('перезапуск, попытка 2 из 2');
    expect(runs[1]).toMatchObject({ state: 'queued', attempt: 2, restart_of: runs[0]!.id });
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'action',
          taskId: t,
          actionId,
          restartOf: runs[0]!.id,
        }),
      }),
    ]);
    expect((await runsOf(fine)).map((r) => r.state)).toEqual(['waiting_human']);

    // the restart reads why the previous attempt failed
    answers = [result({ verdict: 'question', comment: '', questions: ['Срок?'] })];
    await drain();
    expect(calls.at(-1)!.prompt).toContain('открытого вопроса в задаче нет');
    [, run] = await runsOf(t);
    expect(run!.state).toBe('waiting_human');

    // again no question: the attempts are spent — stopped with the reason, no new run
    await lose();
    jobs.length = 0;
    await reconcile();
    runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.state).toBe('failed');
    expect(runs[1]!.log).toContain('попытки исчерпаны (2 из 2), прогон остановлен');
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([]);
    const stop = (await commentsOf(t)).find((c) => text(c.body).includes('Прогон ИИ остановлен'))!;
    expect(stop.assignee_id).toBe(w.member.userId);
    const events = await raw(
      `select text, level from ai_engine_events where task_id = $1 order by at, id`,
      [t],
    );
    expect(events).toContainEqual({
      level: 'error',
      text: expect.stringMatching(
        /^сверка: .+ открытого вопроса в задаче нет .+ прогон остановлен$/,
      ),
    });

    // no endless loop: the next passes change nothing
    await reconcile();
    await reconcile();
    expect(await runsOf(t)).toHaveLength(2);
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([]);
    expect(
      (await commentsOf(t)).filter((c) => text(c.body).includes('Прогон ИИ остановлен')),
    ).toHaveLength(1);
  });

  it('PLNRAPP-741: прогон вернул «вопрос», а вопрос не опубликован (ошибка) — сверка повторяет в пределах попыток и останавливает с причиной', async () => {
    await w.admin.ok('ai.action.update', { id: actionId, maxAttempts: 2 });
    await rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId },
    ]);
    // the question status of another project: the move is rejected — the question never gets into the task
    const other = await project();
    await raw(
      `update ai_actions set question_status_id = (select id from statuses where project_id = $1 limit 1)
       where id = $2`,
      [other, actionId],
    );
    const t = await task({ statusId: S.backlog });
    const reconcile = () => handler('ai', 'ai.engine.reconcile')({}, api);
    const ask = () => {
      answers = [
        result({
          verdict: 'question',
          comment: 'Вопрос отправлен в задачу',
          questions: ['Бюджет?'],
        }),
      ];
    };
    const unpause = (id: string) =>
      raw(`update ai_runs set finished_at = now() - interval '10 min' where id = $1`, [id]);
    jobs.length = 0;
    await reconcile();
    ask();
    await drain();
    let runs = await runsOf(t);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: 'failed', attempt: 1, question_comment_ids: [] });
    expect(runs[0]!.log).toContain('вопрос в задаче не опубликован');
    expect(runs[0]!.report).toMatchObject({
      lostQuestion: expect.stringContaining('вопрос в задаче не опубликован'),
    });

    // the restart is attempt 2 and its prompt reads why the previous one failed
    await unpause(runs[0]!.id as string);
    await reconcile();
    ask();
    await drain();
    expect(calls.at(-1)!.prompt).toContain('вопрос в задаче не опубликован');
    runs = await runsOf(t);
    expect(runs.map((r) => [r.state, r.attempt])).toEqual([
      ['failed', 1],
      ['failed', 2],
    ]);
    expect(runs[1]!.restart_of).toBe(runs[0]!.id);

    // the attempts spent: no new run, the reason in the run's log (the AI tab), the person is told, the monitor errs
    await unpause(runs[1]!.id as string);
    jobs.length = 0;
    await reconcile();
    runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([]);
    expect(runs[1]!.log).toMatch(
      /вопрос в задаче не опубликован .+ попытки исчерпаны \(2 из 2\), прогон остановлен/,
    );
    const stop = (await commentsOf(t)).filter((c) => text(c.body).includes('Прогон ИИ остановлен'));
    expect(stop).toHaveLength(1);
    expect(stop[0]!.assignee_id).toBe(w.member.userId);
    const events = await raw(`select text, level from ai_engine_events where task_id = $1`, [t]);
    expect(events).toContainEqual({
      level: 'error',
      text: expect.stringMatching(
        /^сверка: .+ вопрос в задаче не опубликован .+ прогон остановлен$/,
      ),
    });

    // no endless loop: the next passes change nothing
    await reconcile();
    await reconcile();
    expect(await runsOf(t)).toHaveLength(2);
    expect(jobs.filter((j) => j.queue === 'ai.run')).toEqual([]);
    expect(
      (await commentsOf(t)).filter((c) => text(c.body).includes('Прогон ИИ остановлен')),
    ).toHaveLength(1);
  });

  it('PLNRAPP-764: вопрос ИИ по поручению сторожа — человеку задачи, ответ продолжает прогон', async () => {
    const t = await task();
    const id = uuidv7();
    await raw(
      `insert into comments (id, space_id, task_id, author_id, body)
       select $1, space_id, id, $2, '{"type":"doc","content":[]}'::jsonb from tasks where id = $3`,
      [id, bot, t],
    );
    answers = [result({ verdict: 'question', questions: ['Куда перевести?'] })];
    await handler('ai', 'ai.run')({ kind: 'mention', taskId: t, itemId: id }, api);
    const [run] = await runsOf(t);
    expect(run!.state).toBe('waiting_human');
    const q = (await commentsOf(t)).find((c) => text(c.body).includes('Куда перевести?'))!;
    expect(q.assignee_id).toBe(w.member.userId);
    expect(run!.question_comment_ids).toEqual([q.id]);
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: q.id,
      body: doc('В «К работе»'),
    });
    expect((await runsOf(t))[0]!.state).toBe('done');
  });

  it('сторож: задача на ИИ в бэклоге со своим правилом ИИ (план) без движения — застряла; бэклог без правила и сборщик harness-retro — нет (PLNRAPP-754)', async () => {
    await w.admin.ok('project.update', { id: P, leadId: w.admin.userId });
    await rule({ type: 'task.status_changed', to: [S.backlog] }, [
      { type: 'ai_run', aiActionId: actionId },
    ]);
    // the plan ended long ago and left the task in «Бэклог» — the reconcile does not run it again
    const stuck = await task({ statusId: S.backlog });
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth, finished_at)
       values ($1, $2, $3, 'action', $4, 'done', $1, 0, now() - interval '3 hours')`,
      [uuidv7(), stuck, P, actionId],
    );
    // a backlog status without an AI rule — a parking place, not stuck
    const parked = await task({ statusId: S.snoozed });
    // «harness-retro»: the bot's bookkeeping in the backlog
    const retro = await task({ statusId: S.backlog });
    await raw(`insert into ai_retro (project_id, task_id) values ($1, $2)`, [P, retro]);
    for (const t of [stuck, parked, retro]) {
      await raw(`update tasks set created_at = now() - interval '3 hours' where id = $1`, [t]);
      await raw(`update activity set created_at = now() - interval '3 hours' where task_id = $1`, [
        t,
      ]);
    }
    jobs.length = 0;
    await handler('ai', 'ai.engine.reconcile')({}, api);
    // the plan is not run again; the stall goes to the AI only as the watchdog's assignment (PLNRAPP-764)
    expect(jobs.filter((j) => j.queue === 'ai.run').map((j) => j.data)).toEqual([
      expect.objectContaining({ kind: 'mention', taskId: stuck }),
    ]);
    const watch = async (t: string) =>
      (await commentsOf(t)).filter((c) => c.author_id === bot && text(c.body).includes('Сторож'));
    expect(await watch(stuck)).toHaveLength(1);
    const backlog = (await one(`select name from statuses where id = $1`, [S.backlog]))
      .name as string;
    expect(text((await watch(stuck))[0]!.body)).toContain(`стоит в «${backlog}»`);
    expect(await watch(parked)).toEqual([]);
    expect(await watch(retro)).toEqual([]);
    const errors = await raw(
      `select task_id from ai_engine_events where level = 'error' and task_id = any($1::uuid[])`,
      [[stuck, parked, retro]],
    );
    expect(errors.map((e) => e.task_id)).toEqual([stuck]);
  });
});

describe('координация подзадач (PLNRAPP-405)', () => {
  const start = (t: string) =>
    handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
  const sub = (o: Record<string, unknown>) => ({
    description: null,
    status: null,
    ai: true,
    after: [],
    checks: [],
    ...o,
  });
  const subsOf = (t: string) =>
    raw(`select * from tasks where parent_id = $1 order by rank collate "C"`, [t]);
  const limits = (autopilot: boolean, dailyTasks: number | null = null) =>
    raw(
      `insert into ai_project_limits (project_id, autopilot, daily_tasks) values ($1, $2, $3)
       on conflict (project_id) do update set autopilot = $2, daily_tasks = $3`,
      [P, autopilot, dailyTasks],
    );
  // PLNRAPP-408: the AI hands work to itself only with the autopilot
  beforeEach(() => limits(true));

  it('PLNRAPP-408: автопилот выключен — подзадачи ИИ человеку в «Уточнение», родитель принимается сразу', async () => {
    await limits(false);
    const parent = await task();
    answers = [result({ newTasks: [sub({ title: 'A' }), sub({ title: 'B', ai: false })] })];
    await start(parent);
    const [a, b] = await subsOf(parent);
    expect(a!.status_id).toBe(S.clarify);
    expect(b!.status_id).toBe(S.todo);
    const who = async (t: unknown) =>
      (await raw(`select user_id from task_assignees where task_id = $1`, [t])).map(
        (x) => x.user_id,
      );
    expect(await who(a!.id)).toEqual([w.member.userId]);
    expect(await who(b!.id)).toEqual([]);
    const [run] = await runsOf(parent);
    expect(run!.state).toBe('done');
    expect(run!.log).toContain('newTasks: A: автопилот выключен — подзадача человеку');
    expect(judged).toHaveLength(1);
  });

  it('PLNRAPP-793: подзадача ИИ себе в статусе вопроса — создаётся в первом «к работе»', async () => {
    const clarify = (await one(`select name from statuses where id = $1`, [S.clarify])).name;
    const parent = await task();
    answers = [
      result({
        newTasks: [
          sub({ title: 'A', status: clarify }),
          sub({ title: 'B', status: clarify, ai: false }),
        ],
      }),
    ];
    await start(parent);
    const [a, b] = await subsOf(parent);
    expect(a!.status_id).toBe(S.todo);
    expect(b!.status_id).toBe(S.clarify);
    expect((await runsOf(parent))[0]!.log).toContain(
      `newTasks: A: подзадача ИИ без вопроса — не в «${clarify}»`,
    );
  });

  it('PLNRAPP-408: суточный потолок задач от ИИ — лишние не создаются, запись в журнале', async () => {
    await limits(true, 3);
    const parent = await task();
    answers = [result({ newTasks: [sub({ title: 'A' }), sub({ title: 'B' })] })];
    await start(parent);
    answers = [result({ newTasks: [sub({ title: 'C' }), sub({ title: 'D' })] })];
    const other = await task();
    await start(other);
    expect((await subsOf(parent)).length + (await subsOf(other)).length).toBe(3);
    expect((await runsOf(other))[0]!.log).toContain('суточный лимит задач ИИ (3) — не создано 1');
    // PLNRAPP-528: and in the AI's comment — not only «Готово» of the model
    expect((await commentsOf(other)).map((c) => text(c.body))).toEqual([
      expect.stringMatching(/Готово.*не создано подзадач — 1 из 2: исчерпан суточный лимит/),
    ]);
  });

  it('PLNRAPP-528: «подзадачи» в поручении — newTasks в схеме первого запроса, без need', async () => {
    const t = await task();
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      body: doc('создавай подзадачи'),
      assigneeId: bot,
    });
    schemas = [];
    answers = [result({ newTasks: [sub({ title: 'A', ai: false })] })];
    await drain();
    expect(schemas.filter((s) => s.includes('comment'))).toHaveLength(1);
    expect(schemas[0]).toContain('newTasks');
    expect((await subsOf(t)).map((x) => x.title)).toEqual(['A']);
  });

  it('criteriaOf: пункты раздела «Критерии приёмки» до следующего заголовка', () => {
    expect(
      criteriaOf(
        'Текст\n\n## Критерии приёмки\n\n- $ pnpm test\n* ссылки целы\n\nабзац\n\n## Дальше\n\n- не то',
      ),
    ).toEqual(['$ pnpm test', 'ссылки целы']);
    expect(criteriaOf('## Другое\n\n- x')).toEqual([]);
  });

  it('разложение → ждёт подзадачи без приёмки; блокированная ждёт; итог подзадачи будит родителя; финал принят проверкой', async () => {
    const doneName = (await one(`select name from statuses where id = $1`, [S.done])).name;
    const parent = await task();
    answers = [
      result({
        comment: 'разложил',
        newTasks: [
          sub({ title: 'Схема БД', description: 'таблицы', checks: ['таблицы описаны'] }),
          sub({ title: 'API', after: [0, 5] }),
          sub({ title: 'Заметка', ai: false }),
        ],
      }),
    ];
    await start(parent);
    expect(judged).toHaveLength(0);
    const [p] = await runsOf(parent);
    expect(p!.state).toBe('waiting_subtasks');
    expect(p!.finished_at).not.toBe(null);
    expect(p!.log).toContain('движок: ждёт подзадачи ИИ');
    expect(p!.log).toContain('newTasks: API: after 5 — не раньше в списке');
    const [a, b, n] = await subsOf(parent);
    expect(text(a!.description)).toContain('Критерии приёмки');
    expect(text(a!.description)).toContain('таблицы описаны');
    const onBot = await raw(
      `select task_id from task_assignees where user_id = $1 and task_id = any($2::uuid[])`,
      [bot, [a!.id, b!.id, n!.id]],
    );
    expect(onBot.map((x) => x.task_id).sort()).toEqual([a!.id, b!.id].sort());
    expect(await raw(`select task_id, kind from task_links where target_id = $1`, [b!.id])).toEqual(
      [{ task_id: a!.id, kind: 'blocks' }],
    );

    // the blocked subtask does not start and leaves no run (the reconcile takes it later)
    jobs.length = 0;
    await start(b!.id as string);
    expect(await runsOf(b!.id as string)).toHaveLength(0);
    expect(calls).toHaveLength(1);

    // the first subtask: its card's criteria join the action's; accepted → the parent wakes up
    answers = [result({ comment: 'схема готова', moveTo: doneName })];
    await start(a!.id as string);
    expect(judged.at(-1)).toContain('таблицы описаны');
    expect(calls.at(-1)!.system).toContain('таблицы описаны');
    expect((await runsOf(a!.id as string))[0]!.state).toBe('done');
    let pr = await runsOf(parent);
    expect(pr.map((r) => r.state)).toEqual(['done', 'queued']);
    expect(jobs.map((j) => j.queue).sort()).toEqual(['ai.engine.reconcile', 'ai.run']);
    expect(jobs.find((j) => j.queue === 'ai.run')!.data).toMatchObject({
      wokenBy: expect.any(String),
    });

    // the parent's next run sees the event and the subtasks; B is open on the AI — waits again, no acceptance
    const checked = judged.length;
    await drain();
    const prompt = calls.at(-1)!.prompt;
    expect(prompt).toContain('# Событие подзадачи');
    expect(prompt).toContain('«Схема БД» — принята');
    expect(prompt).toContain('ИИ: принято');
    pr = await runsOf(parent);
    expect(pr.map((r) => r.state)).toEqual(['done', 'waiting_subtasks']);
    expect(judged).toHaveLength(checked);

    // B is unblocked now; its outcome wakes the parent, which finishes through its checks
    answers = [result({ comment: 'API готово', moveTo: doneName })];
    await start(b!.id as string);
    expect((await runsOf(b!.id as string))[0]!.state).toBe('done');
    answers = [result({ comment: 'всё готово' })];
    await drain();
    pr = await runsOf(parent);
    expect(pr.map((r) => r.state)).toEqual(['done', 'done', 'done']);
    expect(pr[2]!.log).toContain('движок: результат принят проверками');
    expect(judged).toHaveLength(checked + 2);
  });

  it('подзадачи ждущего родителя — по одной (max_agents проекта); без ждущего родителя — без очереди', async () => {
    const parent = await task();
    answers = [result({ newTasks: [sub({ title: 'A' }), sub({ title: 'B' })] })];
    await start(parent);
    const [a, b] = await subsOf(parent);
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth)
       values ($1, $2, $3, 'action', $4, 'running', $1, 0)`,
      [uuidv7(), a!.id, P, actionId],
    );
    jobs.length = 0;
    await start(b!.id as string);
    expect(await runsOf(b!.id as string)).toHaveLength(0);
    expect(jobs).toEqual([expect.objectContaining({ queue: 'ai.run', opts: { startAfter: 30 } })]);
    await raw(
      `insert into ai_project_limits (project_id, max_agents) values ($1, 2)
       on conflict (project_id) do update set max_agents = 2`,
      [P],
    );
    await start(b!.id as string);
    expect((await runsOf(b!.id as string))[0]!.state).toBe('done');
  });

  it('PLNRAPP-744: подзадача ИИ с описанием — без триажа по «задача создана»; без описания — триаж идёт', async () => {
    const triage = await action({ name: 'Триаж', checks: [] });
    await rule({ type: 'task.created' }, [{ type: 'ai_run', aiActionId: triage }]);
    const parent = await task();
    jobs.length = 0;
    answers = [
      result({
        newTasks: [
          sub({ title: 'С описанием', description: 'что сделать', checks: ['тест проходит'] }),
          sub({ title: 'Без описания' }),
        ],
      }),
    ];
    await start(parent);
    const [a, b] = await subsOf(parent);
    expect(a!.created_by).toBe(bot);
    answers = [result({ comment: 'разобрал' })];
    await drain();
    expect(await runsOf(a!.id as string)).toHaveLength(0);
    const [rb] = await runsOf(b!.id as string);
    expect(rb).toMatchObject({ action_id: triage, state: 'done' });
    expect((await taskRow(a!.id as string)).status_id).toBe(S.todo);
  });

  it('ревью свежим контекстом: отметка review у действия — даже без критериев', async () => {
    await w.admin.ok('ai.action.update', { id: actionId, checks: [], review: true });
    const t = await task();
    verdicts = [{ pass: false, failures: ['не по задаче'] }];
    await start(t);
    expect(judged).toHaveLength(1);
    expect(judged[0]).toContain('проверь, что результат выполняет задачу');
    const [run] = await runsOf(t);
    expect(run!.report).toMatchObject({ failures: ['не по задаче'] });
    expect(run!.log).toContain('движок: ревью свежим контекстом');
  });
});

describe('выключатель и суточные лимиты', () => {
  const start = (t: string) =>
    handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId }, api);
  const spend = (t: string, tokens: number, cost: number | null) =>
    raw(
      `insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth, input_tokens, cost)
       values ($1, $2, $3, 'action', 'done', $1, 0, $4, $5)`,
      [uuidv7(), t, P, tokens, cost],
    );

  it('ИИ выключен → прогон failed с логом, провайдер не вызван', async () => {
    const t = await task();
    await raw(`insert into ai_settings (id, enabled) values (1, false)`);
    try {
      await start(t);
    } finally {
      await raw(`delete from ai_settings`);
    }
    expect(calls).toHaveLength(0);
    expect((await runsOf(t)).at(-1)).toMatchObject({ state: 'failed' });
    expect((await runsOf(t)).at(-1)!.log).toContain('выключен');
  });

  it('PLNRAPP-638: действие без страницы промпта → failed с причиной и подсказкой в комментарии, провайдер не вызван', async () => {
    const t = await task();
    const bare = await action({ name: 'Тест', pageId: null });
    await handler('ai', 'ai.run')({ kind: 'action', taskId: t, actionId: bare }, api);
    expect(calls).toHaveLength(0);
    expect((await runsOf(t)).at(-1)).toMatchObject({ state: 'failed' });
    const c = text((await commentsOf(t)).at(-1)!.body);
    expect(c).toContain('У действия «Тест» нет инструкции');
    expect(c).toContain('страницу промпта');
  });

  it('лимит токенов проекта за сутки → failed без вызова; под лимитом — идёт', async () => {
    const t = await task();
    await raw(`insert into ai_project_limits (project_id, daily_tokens) values ($1, 1000)`, [P]);
    await spend(t, 999, null);
    await start(t);
    expect(calls).toHaveLength(1);
    await spend(t, 1, null);
    await start(t);
    expect(calls).toHaveLength(1);
    const last = (await runsOf(t)).at(-1)!;
    expect(last.state).toBe('failed');
    expect(last.log).toContain('лимит токенов');
  });

  it('лимит стоимости: свой у проекта, иначе PLANAR_AI_DAILY_COST; вчерашние прогоны не считаются', async () => {
    const t = await task();
    await spend(t, 0, 2);
    await raw(`insert into ai_project_limits (project_id, daily_cost) values ($1, 2)`, [P]);
    await start(t);
    expect((await runsOf(t)).at(-1)!.log).toContain('лимит стоимости');
    await raw(`update ai_runs set created_at = now() - interval '2 days' where task_id = $1`, [t]);
    await start(t);
    expect((await runsOf(t)).at(-1)!.state).toBe('done');
    await raw(`delete from ai_project_limits where project_id = $1`, [P]);
    await spend(t, 0, 3);
    process.env.PLANAR_AI_DAILY_COST = '3';
    try {
      await start(t);
    } finally {
      delete process.env.PLANAR_AI_DAILY_COST;
    }
    expect((await runsOf(t)).at(-1)!.log).toContain('лимит стоимости');
  });
});

describe('поручения ИИ', () => {
  it('комментарий на ИИ: ответ в треде и закрытие; вопрос → автору, ответ автора возвращает поручение', async () => {
    const t = await task();
    const c = uuidv7();
    await w.member.ok('comment.create', {
      id: c,
      taskId: t,
      body: doc('оцени трудоёмкость'),
      assigneeId: bot,
    });
    expect(jobs).toEqual([
      {
        queue: 'ai.run',
        data: { kind: 'comment', taskId: t, itemId: c, runId: expect.any(String) },
        opts: expect.objectContaining({ upsert: true }),
      },
    ]);
    // AST-1: the run waits as a `queued` row (the job carries its id); the handler turns it into `running`
    const rid = (jobs[0]!.data as { runId: string }).runId;
    expect((await runsOf(t)).map((r) => [r.id, r.state])).toEqual([[rid, 'queued']]);
    // a newer assignment of the same comment replaces the queued one: one `queued` per key
    await w.member.ok('comment.assign', { id: c, assigneeId: null });
    await w.member.ok('comment.assign', { id: c, assigneeId: bot });
    expect((await runsOf(t)).map((r) => r.state).sort()).toEqual(['cancelled', 'queued']);
    jobs.splice(0, jobs.length - 1);
    const rid2 = (jobs[0]!.data as { runId: string }).runId;
    expect(rid2).not.toBe(rid);
    // the cancelled run's job is skipped, the live one starts its row
    await handler('ai', 'ai.run')({ ...(jobs[0]!.data as object), runId: rid } as never, api);
    expect((await runsOf(t)).map((r) => r.state).sort()).toEqual(['cancelled', 'queued']);
    answers = [
      result({ verdict: 'question', comment: 'Уточни', questions: ['Какой стек?'] }),
      result({ comment: '3 дня' }),
    ];
    await drain();
    expect(calls[0]!.prompt).toContain('оцени трудоёмкость');
    let root = await one(`select * from comments where id = $1`, [c]);
    expect(root.assignee_id).toBe(w.member.userId);
    const q = (await commentsOf(t)).find((x) => x.parent_id === c)!;
    expect(q.mentions).toEqual([w.member.userId]);
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: q.id,
      body: doc('Vue'),
    });
    await drain();
    root = await one(`select * from comments where id = $1`, [c]);
    expect(root.assignee_id).toBe(bot);
    expect(root.resolved_at).not.toBeNull();
    expect(text((await commentsOf(t)).at(-1)!.body)).toContain('3 дня');
  });

  it('PLNRAPP-361: комментарий задачи меняет её подзадачи по ключу; не подзадача — в лог', async () => {
    const hot = uuidv7();
    await w.admin.ok('label.create', { id: hot, projectId: P, name: 'Горячий', color: '#f00' });
    const t = await task();
    const sub = await task({ parentId: t, title: 'Старое', assignees: [] });
    const other = await task({ assignees: [] });
    const keyOf = async (id: string) =>
      (
        await one(
          `select p.key || '-' || t.number as k from tasks t join projects p on p.id = t.project_id where t.id = $1`,
          [id],
        )
      ).k as string;
    const [subKey, otherKey] = [await keyOf(sub), await keyOf(other)];
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      body: doc('отложи подзадачу'),
      assigneeId: bot,
    });
    answers = [
      result({
        subtasks: [
          { key: subKey, title: 'Новое', moveTo: 'Отложено', labels: ['горячий'], fields: [] },
          { key: otherKey, title: '', moveTo: 'Отложено', labels: [], fields: [] },
        ],
      }),
    ];
    await drain();
    expect(calls[0]!.prompt).toContain(`${subKey}: Старое`);
    const s = await taskRow(sub);
    expect([s.title, s.status_id]).toEqual(['Новое', S.snoozed]);
    expect(await raw(`select label_id from task_labels where task_id = $1`, [sub])).toEqual([
      { label_id: hot },
    ]);
    expect((await taskRow(other)).status_id).toBe(S.todo);
    expect((await runsOf(t))[0]!.log).toContain(`нет подзадачи «${otherKey}»`);
  });

  it('@ai: ответ в треде, без закрытия; назначенный и упомянувший — один раз', async () => {
    const t = await task();
    const c = uuidv7();
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: bot, label: 'ai' } },
            { type: 'text', text: ' что решили?' },
          ],
        },
      ],
    };
    await w.member.ok('comment.create', { id: c, taskId: t, body });
    expect(jobs.map((j) => j.data.kind)).toEqual(['mention']);
    answers = [result({ comment: 'Решили делать CRM' })];
    await drain();
    const replies = (await commentsOf(t)).filter((x) => x.parent_id === c);
    expect(replies.map((x) => text(x.body))).toEqual([
      expect.stringContaining('Решили делать CRM'),
    ]);
    jobs.length = 0;
    await w.member.ok('comment.create', { id: uuidv7(), taskId: t, body, assigneeId: bot });
    expect(jobs.map((j) => j.data.kind)).toEqual(['comment']);
  });

  it('ответ на комментарий ИИ — поручение, как @ai: ответ в треде; ответ на чужой комментарий — нет', async () => {
    const t = await task();
    const root = uuidv7();
    await api.execute(bot, [
      { name: 'comment.create', args: { id: root, taskId: t, body: doc('План готов') } },
    ]);
    const human = uuidv7();
    await w.member.ok('comment.create', { id: human, taskId: t, body: doc('заметка') });
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: human,
      body: doc('ок'),
    });
    expect(jobs).toHaveLength(0);
    const c = uuidv7();
    await w.member.ok('comment.create', {
      id: c,
      taskId: t,
      parentId: root,
      body: doc('а сроки?'),
    });
    expect(jobs.map((j) => j.data)).toEqual([
      { kind: 'mention', taskId: t, itemId: c, runId: expect.any(String) },
    ]);
    answers = [result({ comment: 'Неделя' })];
    await drain();
    expect(calls[0]!.prompt).toContain('а сроки?');
    const replies = (await commentsOf(t)).filter((x) => x.parent_id === c);
    expect(replies.map((x) => text(x.body))).toEqual([expect.stringContaining('Неделя')]);
  });

  it('пункты чек-листа на ИИ — по порядку rank, отмечаются выполненными', async () => {
    const t = await task();
    const [a, b] = [uuidv7(), uuidv7()];
    await w.member.ok('checklist.add', { id: b, taskId: t, text: 'второй', rank: 'b0' });
    await w.member.ok('checklist.add', { id: a, taskId: t, text: 'первый', rank: 'a0' });
    await w.member.ok('checklist.update', { id: b, assigneeId: bot });
    await w.member.ok('checklist.update', { id: a, assigneeId: bot });
    answers = [result({ comment: 'сделан первый' }), result({ comment: 'сделан второй' })];
    await drain();
    expect(calls.map((c) => c.prompt.split('\n').at(-1))).toEqual(['первый', 'второй']);
    expect(
      await raw(`select done from checklist_items where task_id = $1 order by rank`, [t]),
    ).toEqual([{ done: true }, { done: true }]);
  });

  it('действия самого ИИ и автоматизаций поручением не считаются', async () => {
    const t = await task();
    await api.execute(bot, [
      {
        name: 'comment.create',
        args: { id: uuidv7(), taskId: t, body: doc('я'), assigneeId: bot },
      },
    ]);
    expect(jobs).toHaveLength(0);
  });
});

describe('письма пачкой', () => {
  const mails = [
    { to: 'a@example.com', subject: 'Тема 1', body: 'Текст <1>' },
    { to: 'b@example.com', subject: 'Тема 2', body: 'Текст 2' },
    { to: 'c@example.com', subject: 'Тема 3', body: 'Текст 3' },
  ];
  const sentMail: { to: string; subject: string; html: string; unsub?: string }[] = [];
  let failTo: string | undefined;
  const snd = async (_cfg: unknown, m: (typeof sentMail)[number]) => {
    if (m.to === failTo) throw new Error('550 rejected');
    sentMail.push(m);
  };
  const emailJobs = () => jobs.filter((j) => j.queue === 'ai.email');
  const batchOf = () => one(`select * from ai_email_batches order by created_at desc limit 1`);
  const reply = (who: typeof w.member, taskId: string, parentId: unknown, t: string) =>
    who.ok('comment.create', { id: uuidv7(), taskId, parentId, body: doc(t) });

  /** a task with a comment on the bot whose run produced the batch; returns the batch comment */
  async function batch(list = mails) {
    const t = await task();
    answers = [result({ comment: 'Письма готовы', emails: list })];
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      body: doc('напиши клиентам'),
      assigneeId: bot,
    });
    await drain();
    const b = await batchOf();
    return { t, b, root: await one(`select * from comments where id = $1`, [b.comment_id]) };
  }

  beforeEach(async () => {
    sentMail.length = 0;
    failTo = undefined;
    await raw(`delete from ai_email_batches`);
    await raw(`delete from email_config`);
    await db.$client.query(
      `insert into email_config (id, host, port, secure, from_address) values ('smtp', 'localhost', 25, false, 'noreply@example.com')`,
    );
  });
  afterAll(() => raw(`delete from email_config`));

  it('isYes: набор слов, регистр и конечная точка', () => {
    for (const s of ['ок', ' OK ', 'Да!', 'Отправить.', 'отправляй!!']) expect(isYes(s)).toBe(true);
    for (const s of ['окей', 'ок, но поправь', 'нет', '']) expect(isYes(s)).toBe(false);
  });

  it('пачка создаётся комментарием на человека и не уходит без «ок»', async () => {
    const { t, b, root } = await batch();
    expect(b).toMatchObject({ state: 'pending', task_id: t });
    expect((b.emails as { state: string }[]).map((e) => e.state)).toEqual([
      'queued',
      'queued',
      'queued',
    ]);
    expect(root).toMatchObject({ author_id: bot, assignee_id: w.member.userId });
    expect(text(root.body)).toContain('b@example.com');
    expect((await runsOf(t))[0]!.state).toBe('waiting_human');
    expect(emailJobs()).toHaveLength(0);
    expect(sentMail).toHaveLength(0);
  });

  it('«ок» не от исполнителя и правки не от него ничего не меняют', async () => {
    const { t, b } = await batch();
    await reply(w.admin, t, b.comment_id, 'ок');
    await reply(w.admin, t, b.comment_id, 'перепиши');
    expect((await batchOf()).state).toBe('pending');
    expect((await runsOf(t))[0]!.state).toBe('waiting_human');
    expect(jobs.filter((j) => j.queue === 'ai.email' || j.data.kind === 'resume')).toHaveLength(0);
  });

  it('переназначивший комментарий на себя не подтверждает пачку: ждёт того, кому назначено при создании', async () => {
    const { t, b } = await batch();
    expect(b.assignee_id).toBe(w.member.userId);
    await raw(`update comments set assignee_id = $1 where id = $2`, [w.admin.userId, b.comment_id]);
    await reply(w.admin, t, b.comment_id, 'ок');
    expect((await batchOf()).state).toBe('pending');
    expect(emailJobs()).toHaveLength(0);
    await reply(w.member, t, b.comment_id, 'ок');
    expect((await batchOf()).state).toBe('sending');
  });

  it('«ок» после остановки прогона или при выключенном ИИ — пачка cancelled, письма не уходят', async () => {
    const stopped = await batch();
    await raw(`update ai_runs set state = 'cancelled' where task_id = $1`, [stopped.t]);
    await reply(w.member, stopped.t, stopped.b.comment_id, 'ок');
    expect((await batchOf()).state).toBe('cancelled');

    const off = await batch();
    await raw(`insert into ai_settings (id, enabled) values (1, false)`);
    try {
      await reply(w.member, off.t, off.b.comment_id, 'ок');
    } finally {
      await raw(`delete from ai_settings`);
    }
    expect((await batchOf()).state).toBe('cancelled');
    expect(emailJobs()).toHaveLength(0);
  });

  it('ответ автора на исходный комментарий не завершает прогон с ожидающей пачкой', async () => {
    const { t, b } = await batch();
    const [first] = (await commentsOf(t)).filter((c) => c.assignee_id === bot);
    await reply(w.member, t, first!.id, 'ок');
    expect((await runsOf(t))[0]!.state).toBe('waiting_human');
    expect((await batchOf()).state).toBe('pending');
    expect(b.state).toBe('pending');
  });

  it('«ок»: джобы со сдвигом 30–60 с накопительно, повтор «ок» ничего не меняет, итог — в тред', async () => {
    const { t, b } = await batch();
    await reply(w.member, t, b.comment_id, ' Ок. ');
    expect((await batchOf()).state).toBe('sending');
    expect((await runsOf(t))[0]!.state).toBe('done');
    const at = emailJobs().map((j) => j.opts!.startAfter as number);
    expect(at).toHaveLength(3);
    at.forEach((x, i) => {
      expect(x).toBeGreaterThanOrEqual(30 * (i + 1));
      expect(x).toBeLessThanOrEqual(60 * (i + 1));
    });
    await reply(w.member, t, b.comment_id, 'ок');
    expect(emailJobs()).toHaveLength(3);

    failTo = 'b@example.com';
    for (const j of emailJobs()) await handleEmail(j.data as never, api, snd as never);
    expect(sentMail.map((m) => m.to)).toEqual(['a@example.com', 'c@example.com']);
    // the text is escaped, no List-Unsubscribe
    expect(sentMail[0]!.html).toContain('Текст &#60;1&#62;');
    expect(sentMail[0]!.unsub).toBeUndefined();
    expect((await batchOf()).state).toBe('sent');
    const last = (await commentsOf(t)).at(-1)!;
    expect(last).toMatchObject({ author_id: bot, parent_id: b.comment_id });
    expect(text(last.body)).toContain('Отправлено писем: 2 из 3');
    expect(text(last.body)).toContain('b@example.com');
    // a repeated job sends nothing
    await handleEmail(emailJobs()[0]!.data as never, api, snd as never);
    expect(sentMail).toHaveLength(2);
  });

  it('лимит в час на проект: лишние письма уходят на следующий час', async () => {
    const { t, b } = await batch();
    const old = await batchOf();
    await raw(
      `insert into ai_email_batches (id, run_id, task_id, project_id, comment_id, state, emails)
       values ($1, $2, $3, $4, $5, 'sent', $6)`,
      [
        uuidv7(),
        uuidv7(),
        t,
        P,
        uuidv7(),
        JSON.stringify(
          Array.from({ length: EMAILS_PER_HOUR - 1 }, () => ({ ...mails[0], state: 'sent' })),
        ),
      ],
    );
    expect(old.id).toBe(b.id);
    await reply(w.member, t, b.comment_id, 'ок');
    const at = emailJobs().map((j) => j.opts!.startAfter as number);
    expect(at[0]).toBeLessThan(3600);
    expect(at[1]).toBeGreaterThanOrEqual(3600);
    expect(at[2]).toBeGreaterThanOrEqual(3600);
  });

  it('правки отменяют пачку и перезапускают прогон с текстом правок', async () => {
    const { t, b } = await batch();
    answers = [result({ comment: 'Переделал' })];
    await reply(w.member, t, b.comment_id, 'Сделай короче');
    expect((await batchOf()).state).toBe('cancelled');
    expect((await runsOf(t))[0]!.state).toBe('done');
    expect(emailJobs()).toHaveLength(0);
    await drain();
    expect(calls.at(-1)!.prompt).toContain('Сделай короче');
    const runs = await runsOf(t);
    expect(runs.map((r) => r.state)).toEqual(['done', 'done']);
    expect(sentMail).toHaveLength(0);
    // a late «ок» on the cancelled batch does nothing
    await reply(w.member, t, b.comment_id, 'ок');
    expect(emailJobs()).toHaveLength(0);
  });
});

describe('план в описании', () => {
  it('withPlan: дописывает блок, если его нет', () => {
    const d = withPlan(markdownToDoc('описание'), 'шаги');
    expect(JSON.stringify(d)).toMatch(/описание.*План \(ИИ\).*шаги/);
  });
});
