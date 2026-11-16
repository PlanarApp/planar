// PLNRAPP-178: harness-retro — frictions, assignments and admins' answers become subtasks of «harness-retro»;
// the retro clusters them into proposals (a subtask in «Уточнение» on the admin, the diff in a comment);
// the admin's answer in the thread applies, closes or redoes. The provider is a local fake (as in run.test.ts).
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encrypt, secretKey } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  DISAGREE_RE,
  RETRO_TITLE,
  diffBlock,
  retroDecision,
  withAction,
  withPrompt,
} from '@planar/module-ai/api';
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

describe('harness-retro: чистые функции', () => {
  it('ответ админа: применить / закрыть / иначе — переделать', () => {
    expect(retroDecision('Применить')).toBe('apply');
    expect(retroDecision('@ai да!')).toBe('apply');
    expect(retroDecision(' ок. ')).toBe('apply');
    expect(retroDecision('закрыть')).toBe('close');
    expect(retroDecision('нет')).toBe('close');
    expect(retroDecision('применить, но без второго пункта')).toBe('redo');
    expect(retroDecision('добавь пример')).toBe('redo');
  });

  it('«не так» — отдельными словами', () => {
    expect(DISAGREE_RE.test('Не так, статус другой')).toBe(true);
    expect(DISAGREE_RE.test('всё не  так')).toBe(true);
    expect(DISAGREE_RE.test('не такой план')).toBe(false);
    expect(DISAGREE_RE.test('отлично')).toBe(false);
  });

  it('withAction: действие и правило в harness.yml; неверный пакет — ошибка', () => {
    const yml = 'statuses:\n  - { key: todo, name: К работе, category: todo }\nactions: [plan]\n';
    const out = withAction(
      yml,
      'digest',
      'name: Дайджест\ntrigger: { type: task.status_changed, to: [todo] }\nactions: [{ type: ai_run, action: digest }]',
    );
    expect(out).toContain('digest');
    expect(out).toContain('Дайджест');
    expect(() =>
      withAction(yml, 'x', 'name: X\ntrigger: { type: t }\nactions: [{ type: ai_run, action: y }]'),
    ).toThrow(/нет действия y/);
    expect(withAction('statuses: []\n', 'a', null)).toMatch(/actions:\s*\n\s*- a/);
  });

  it('diffBlock: изменения с контекстом, остальное свёрнуто', () => {
    const a = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n');
    const b = ['1', '2', '3', '4', '5', '6', '7', '8', 'новое'].join('\n');
    const d = diffBlock(a, b);
    expect(d).toContain('+ новое');
    expect(d).toContain('  7');
    expect(d).toContain('…');
    expect(d).not.toContain('  1');
  });

  it('withPrompt: описание и таблица параметров остаются, промпт заменяется', () => {
    const body = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'описание' }] },
        { type: 'table', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'старый промпт' }] },
      ],
    };
    const out = JSON.stringify(withPrompt(body, 'новый промпт'));
    expect(out).toContain('описание');
    expect(out).toContain('"table"');
    expect(out).toContain('новый промпт');
    expect(out).not.toContain('старый промпт');
  });
});

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;
let api: JobApi;
let bot: string;
let srv: http.Server;
type Job = { queue: string; data: Record<string, unknown>; opts?: Record<string, unknown> };
const jobs: Job[] = [];
let answers: object[] = [];
let calls: { system: string; prompt: string }[] = [];

const handler = (q: string) =>
  (
    installed.find((m) => m.api.id === 'ai')!.api.jobs as {
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
  ...o,
});

const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const one = async (text: string, values: unknown[] = []) => (await raw(text, values))[0]!;

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
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body) as { messages: { role: string; content: string }[] };
      calls.push({
        system: b.messages.find((m) => m.role === 'system')?.content ?? '',
        prompt: b.messages.find((m) => m.role === 'user')?.content ?? '',
      });
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
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  await raw(`delete from ai_connections`);
  await raw(
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

let P: string;
let S: { todo: string; done: string; clarify: string };
let actionId: string;
let pageId: string;

const PROMPT = 'Проверь задачу и составь план.';
const row = (k: string, v: string) => ({
  type: 'tableRow',
  content: [k, v].map((t) => ({
    type: 'tableCell',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
  })),
});

beforeEach(async () => {
  P = uuidv7();
  await w.admin.ok('project.create', {
    id: P,
    spaceId: w.spaceId,
    name: 'R',
    key: key(),
    rank: 'a0',
  });
  useProject(w, P);
  bot = (await one(`select id from users where login = 'ai' and bot`)).id as string;
  const st = await raw(`select id, category from statuses where project_id = $1 order by rank`, [
    P,
  ]);
  const of = (c: string) => st.find((s) => s.category === c)!.id as string;
  const clarify = uuidv7();
  await w.admin.ok('status.create', {
    id: clarify,
    projectId: P,
    name: 'Уточнение',
    category: 'todo',
    color: '#000',
    rank: 'b0',
  });
  S = { todo: of('todo'), done: of('done'), clarify };
  // the active pack: the root page with harness.yml, the instruction «Планирование» under it
  const root = uuidv7();
  await w.admin.ok('docs.page.create', {
    id: root,
    spaceId: w.spaceId,
    projectId: P,
    rank: 'a0',
    title: 'Пакет',
    body: {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'yaml' },
          content: [
            {
              type: 'text',
              text: 'statuses:\n  - { key: todo, name: К работе, category: todo }\nactions: [plan]',
            },
          ],
        },
      ],
    },
  });
  pageId = uuidv7();
  await w.admin.ok('docs.page.create', {
    id: pageId,
    spaceId: w.spaceId,
    parentId: root,
    rank: 'a0',
    title: 'Планирование',
    body: {
      type: 'doc',
      content: [
        { type: 'table', content: [row('Параметр', 'Значение'), row('key', 'plan')] },
        { type: 'paragraph', content: [{ type: 'text', text: PROMPT }] },
      ],
    },
  });
  await raw(
    `insert into ai_harness_packs (id, project_id, pack_key, active, root_page_id) values ($1, $2, 'dev', true, $3)`,
    [uuidv7(), P, root],
  );
  actionId = uuidv7();
  await w.admin.ok('ai.action.create', {
    id: actionId,
    projectId: P,
    key: 'plan',
    name: 'Планирование',
    pageId,
    questionStatusId: S.clarify,
  });
  jobs.length = 0;
  answers = [];
  calls = [];
});

async function task(title = 'Сделать CRM') {
  const id = uuidv7();
  await w.admin.ok('task.create', {
    id,
    projectId: P,
    statusId: S.todo,
    title,
    rank: 'a0',
    assignees: [{ id: uuidv7(), userId: bot }],
  });
  return id;
}
const runAction = (taskId: string, answer: object) => {
  answers.push(answer);
  return handler('ai.run')({ kind: 'action', taskId, actionId }, api);
};
const retroTask = async () =>
  (await one(`select task_id from ai_retro where project_id = $1`, [P])).task_id as string;
const items = async () =>
  raw(
    `select t.id, t.title, t.status_id, t.description::text as d from tasks t where t.parent_id = $1
     order by t.created_at, t.id`,
    [await retroTask()],
  );
const take = (q: string) => {
  const i = jobs.findIndex((j) => j.queue === q);
  return i < 0 ? undefined : jobs.splice(i, 1)[0];
};

describe('harness-retro: сбор подзадач', () => {
  it('трение прогона → задача «harness-retro» и подзадача; удалили задачу — следующее трение создаёт новую', async () => {
    const t = await task();
    await runAction(t, result({ friction: 'Нет критериев готовности плана' }));
    const r = await one(`select title, parent_id from tasks where id = $1`, [await retroTask()]);
    expect(r).toMatchObject({ title: RETRO_TITLE, parent_id: null });
    const [i] = await items();
    expect(i!.title).toMatch(/^Трение: .* · Планирование · Нет критериев/);
    expect(i!.d).toContain('Нет критериев готовности плана');
    expect((await one(`select frictions from ai_retro where project_id = $1`, [P])).frictions).toBe(
      1,
    );

    const first = await retroTask();
    await w.admin.ok('task.delete', { id: first });
    await runAction(t, result({ friction: 'Опять нет критериев' }));
    expect(await retroTask()).not.toBe(first);
    expect(await items()).toHaveLength(1);
  });

  it('раз в N трений ставится retro; без трения — нет', async () => {
    await raw(`insert into ai_retro (project_id, every_frictions) values ($1, 2)`, [P]);
    const t = await task();
    await runAction(t, result({}));
    await runAction(t, result({ friction: 'раз' }));
    expect(take('ai.retro')).toBeUndefined();
    await runAction(t, result({ friction: 'два' }));
    expect(take('ai.retro')).toMatchObject({
      data: { kind: 'run', projectId: P },
      opts: { singletonKey: `retro:${P}`, upsert: true },
    });
  });

  it('итог поручения → подзадача с поручением и ответом ИИ', async () => {
    const t = await task();
    const c = uuidv7();
    await w.admin.ok('comment.create', {
      id: c,
      taskId: t,
      body: doc('собери отчёт'),
      assigneeId: bot,
    });
    answers.push(result({ comment: 'Отчёт собран' }));
    await handler('ai.run')(take('ai.run')!.data, api);
    const [i] = await items();
    expect(i!.title).toMatch(/^Поручение: .* · собери отчёт/);
    expect(i!.d).toContain('Отчёт собран');
  });

  it('«не так» админа на комментарий ИИ и ручной откат статуса → подзадачи', async () => {
    const t = await task();
    const done = (await one(`select name from statuses where id = $1`, [S.done])).name as string;
    await runAction(t, result({ comment: 'План готов', moveTo: done }));
    expect((await one(`select status_id from tasks where id = $1`, [t])).status_id).toBe(S.done);
    const botComment = (
      await one(`select id from comments where task_id = $1 and author_id = $2`, [t, bot])
    ).id as string;
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: botComment,
      body: doc('Не так: план без сроков'),
    });
    await w.admin.ok('task.update', { id: t, statusId: S.todo });
    for (let j = take('ai.retro'); j; j = take('ai.retro')) await handler('ai.retro')(j.data, api);
    const titles = (await items()).map((i) => i.title as string);
    expect(titles.some((x) => x.startsWith('Ответ админа:') && x.includes('план без сроков'))).toBe(
      true,
    );
    expect(titles.some((x) => x.startsWith('Откат статуса:'))).toBe(true);
  });

  it('участник (не админ) — не ответ админа; выключатель — подзадач нет', async () => {
    const t = await task();
    await runAction(t, result({ comment: 'План' }));
    const botComment = (
      await one(`select id from comments where task_id = $1 and author_id = $2`, [t, bot])
    ).id as string;
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      parentId: botComment,
      body: doc('не так'),
    });
    expect(take('ai.retro')).toBeUndefined();
    await raw(`insert into ai_retro (project_id, enabled) values ($1, false)`, [P]);
    await runAction(t, result({ friction: 'мешало' }));
    expect(await one(`select task_id from ai_retro where project_id = $1`, [P])).toMatchObject({
      task_id: null,
    });
  });
});

describe('harness-retro: предложения', () => {
  async function propose() {
    const t = await task();
    await runAction(t, result({ friction: 'Нет критериев готовности' }));
    const [item] = await items();
    const itemKey = (
      await one(
        `select p.key || '-' || t.number as k from tasks t join projects p on p.id = t.project_id where t.id = $1`,
        [item!.id],
      )
    ).k as string;
    answers.push({
      proposals: [
        {
          title: 'Критерии готовности в плане',
          why: 'Прогоны не знали, когда план готов.',
          items: [itemKey],
          action: 'plan',
          newAction: null,
          prompt: `${PROMPT}\n\nВ конце плана — критерии готовности.`,
        },
      ],
    });
    await handler('ai.retro')({ kind: 'run', projectId: P }, api);
    expect(calls.at(-1)!.prompt).toContain('Нет критериев готовности');
    expect(calls.at(-1)!.prompt).toContain(PROMPT);
    const p = await one(`select * from ai_retro_proposals where project_id = $1`, [P]);
    return { p, item: item!.id as string };
  }

  it('retro → подзадача в «Уточнении» на админа, diff в комментарии; «применить» пишет инструкцию', async () => {
    const { p, item } = await propose();
    expect(p).toMatchObject({
      state: 'pending',
      action_key: 'plan',
      page_id: pageId,
      items: [item],
    });
    const pt = await one(`select status_id, parent_id from tasks where id = $1`, [p.task_id]);
    expect(pt).toEqual({ status_id: S.clarify, parent_id: await retroTask() });
    expect(await one(`select user_id from task_assignees where task_id = $1`, [p.task_id])).toEqual(
      { user_id: w.admin.userId },
    );
    const c = await one(`select assignee_id, body::text as b from comments where id = $1`, [
      p.comment_id,
    ]);
    expect(c.assignee_id).toBe(w.admin.userId);
    expect(c.b).toContain('+ В конце плана — критерии готовности.');
    expect(
      await one(`select state, kind from ai_runs where task_id = $1`, [await retroTask()]),
    ).toEqual({ state: 'done', kind: 'retro' });

    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: p.task_id,
      parentId: p.comment_id,
      body: doc('применить'),
    });
    // the answer is a decision, not a request to the bot
    expect(take('ai.run')).toBeUndefined();
    await handler('ai.retro')(take('ai.retro')!.data, api);
    const page = await one(`select body::text as b from docs_pages where id = $1`, [pageId]);
    expect(page.b).toContain('критерии готовности');
    expect(page.b).toContain('"table"');
    expect((await one(`select state from ai_retro_proposals where id = $1`, [p.id])).state).toBe(
      'applied',
    );
    expect((await one(`select status_id from tasks where id = $1`, [item])).status_id).toBe(S.done);
    expect((await one(`select status_id from tasks where id = $1`, [p.task_id])).status_id).toBe(
      S.done,
    );
  });

  it('замечание админа → предложение переделано, новый diff; «закрыть» — не применяется', async () => {
    const { p } = await propose();
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: p.task_id,
      parentId: p.comment_id,
      body: doc('добавь пример критерия'),
    });
    answers.push({
      title: 'Критерии с примером',
      why: 'Добавлен пример.',
      prompt: `${PROMPT}\n\nВ конце плана — критерии готовности, например «тесты зелёные».`,
      rule: null,
    });
    await handler('ai.retro')(take('ai.retro')!.data, api);
    expect(calls.at(-1)!.prompt).toContain('добавь пример критерия');
    const q = await one(`select * from ai_retro_proposals where id = $1`, [p.id]);
    expect(q.comment_id).not.toBe(p.comment_id);
    expect(q.state).toBe('pending');
    expect(
      (await one(`select resolved_at from comments where id = $1`, [p.comment_id])).resolved_at,
    ).toBeTruthy();
    const c = await one(`select body::text as b from comments where id = $1`, [q.comment_id]);
    expect(c.b).toContain('тесты зелёные');

    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: p.task_id,
      parentId: q.comment_id,
      body: doc('закрыть'),
    });
    await handler('ai.retro')(take('ai.retro')!.data, api);
    expect((await one(`select state from ai_retro_proposals where id = $1`, [p.id])).state).toBe(
      'closed',
    );
    const page = await one(`select body::text as b from docs_pages where id = $1`, [pageId]);
    expect(page.b).not.toContain('критерии готовности');
  });
});
