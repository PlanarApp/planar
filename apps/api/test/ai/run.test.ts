// PLNRAPP-168: AI actions and the llm run flow — ai_run, «Уточнение», answers in the thread, assignments.
// The provider is a local fake of an OpenAI-compatible server: each call takes the next queued result.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encrypt, secretKey } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  EMAILS_PER_HOUR,
  MAX_CHAIN,
  PLAN_HEADING,
  handleEmail,
  isYes,
  withPlan,
} from '@planar/module-ai/api';
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
let calls: { system: string; prompt: string }[] = [];
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
      const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
      calls.push({
        system: body.messages.find((m) => m.role === 'system')?.content ?? '',
        prompt: body.messages.find((m) => m.role === 'user')?.content ?? '',
      });
      await onCall?.();
      const next = answers.shift() ?? result({});
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'fake',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify(next) },
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
        opts: { singletonKey: `${t}:${actionId}`, upsert: true, startAfter: 60 },
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
    await w.admin.ok('task.update', { id: t, statusId: S.backlog });
    await drain();
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
          { title: 'Подзадача', description: null, status: null },
          { title: 'Исправление', description: null, status: 'Отложено' },
          { title: 'Мимо', description: null, status: 'Нет статуса' },
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
        data: { kind: 'comment', taskId: t, itemId: c },
        opts: expect.objectContaining({ upsert: true }),
      },
    ]);
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
