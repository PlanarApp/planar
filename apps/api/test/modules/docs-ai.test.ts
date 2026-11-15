// docai-run v2: the AI run over a page comment (llm path): @ai, assignment, reply to the bot, the bot's own comment.
// The provider is a local fake of an OpenAI-compatible server (as in ai/run.test.ts).
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encrypt, secretKey } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
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
let P: string;
let pageId: string;
type Job = { queue: string; data: Record<string, unknown> };
const jobs: Job[] = [];
let answers: object[] = [];
let prompts: string[] = [];
let systems: string[] = [];
let models: string[] = [];

const kinds = () => jobs.filter((j) => j.queue === 'ai.run').map((j) => j.data.kind);
const aiRun = (
  installed.find((m) => m.api.id === 'ai')!.api.jobs as {
    queue: string;
    handler(d: unknown, api: JobApi): Promise<void>;
  }[]
).find((j) => j.queue === 'ai.run')!.handler;

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
  pagePatch: null,
  ...o,
});
const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const one = async (text: string, values: unknown[] = []) => (await raw(text, values))[0]!;
async function drain() {
  for (let i = 0; i < 20; i++) {
    const j = jobs.findIndex((x) => x.queue === 'ai.run');
    if (j < 0) return;
    const [job] = jobs.splice(j, 1);
    await aiRun(job!.data, api);
  }
  throw new Error('drain: too many jobs');
}
const say = (text: string, ...mentions: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text },
        ...mentions.map((id) => ({ type: 'mention', attrs: { id } })),
      ],
    },
  ],
});
const put = async (c: TestClient, over: Record<string, unknown> = {}) => {
  const id = uuidv7();
  await c.ok('docs.comment.create', { id, pageId, body: say('текст'), ...over });
  return id;
};
const comments = () =>
  raw(`select * from docs_comments where page_id = $1 order by created_at, id`, [pageId]);
const runs = () =>
  raw(`select * from ai_runs where page_id = $1 order by created_at, id`, [pageId]);

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = randomBytes(32).toString('base64');
  w = await world(db);
  const svc = { ...services(db), push: new PushService(db, queue) };
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    w[c] = new TestClient(svc, w[c].userId);
  const capture = async (q: string, data: object) =>
    void jobs.push({ queue: q, data: data as never });
  queue.jobs.enqueue = capture;
  api = { ...(await queue.jobs.api()), enqueue: capture };
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = JSON.parse(body) as {
        model: string;
        messages: { role: string; content: string }[];
      };
      systems.push(m.messages.find((x) => x.role === 'system')?.content ?? '');
      models.push(m.model);
      prompts.push(m.messages.find((x) => x.role === 'user')?.content ?? '');
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
                content: JSON.stringify(answers.shift() ?? result({})),
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

beforeEach(async () => {
  P = uuidv7();
  await w.admin.ok('project.create', {
    id: P,
    spaceId: w.spaceId,
    name: 'AI',
    key: key(),
    rank: 'a0',
  });
  useProject(w, P);
  bot = (await one(`select id from users where login = 'ai' and bot`)).id as string;
  pageId = uuidv7();
  await w.admin.ok('docs.page.create', {
    id: pageId,
    spaceId: w.spaceId,
    projectId: P,
    rank: 'a0',
    title: 'Спецификация',
    body: doc('Тело страницы.'),
  });
  jobs.length = 0;
  answers = [];
  prompts = [];
  systems = [];
  models = [];
});

describe('ИИ в комментариях страницы', () => {
  it('@ai: ответ в ветке под корнем, комментарий не закрывается; page_id заполнен, task_id null', async () => {
    const root = await put(w.member, { body: say('вопрос ', bot) });
    expect(kinds()).toEqual(['doc_mention']);
    answers = [result({ comment: 'Вот ответ' })];
    await drain();
    const [r] = await runs();
    expect(r).toMatchObject({
      kind: 'doc_mention',
      state: 'done',
      task_id: null,
      page_id: pageId,
      item_id: root,
      project_id: P,
    });
    expect(prompts[0]).toContain('Тело страницы.');
    const [, reply] = await comments();
    expect(reply).toMatchObject({ author_id: bot, parent_id: root, resolved_at: null });
    expect(JSON.stringify(reply!.body)).toContain('Вот ответ');
  });

  it('назначение на ИИ: ответ в ветку и resolve; ответ человека на комментарий ИИ — новый прогон; комментарий бота прогон не запускает', async () => {
    const root = await put(w.member, { assigneeId: bot });
    expect(kinds()).toEqual(['doc_comment']);
    answers = [result({ comment: 'Сделал' })];
    await drain();
    const rows = await comments();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.resolved_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ author_id: bot, parent_id: root });
    // the bot's comment (origin of a run) started nothing
    expect(kinds()).toEqual([]);
    const botComment = rows[1]!.id as string;
    await put(w.member, { parentId: botComment, body: say('а ещё?') });
    expect(kinds()).toEqual(['doc_mention']);
    await drain();
    expect(await comments()).toHaveLength(4);
    expect((await runs()).map((r) => r.state)).toEqual(['done', 'done']);
    // a reply to a person's comment is not a request
    const other = await put(w.admin);
    await put(w.member, { parentId: other });
    expect(kinds()).toEqual([]);
  });

  it('вопрос: в ветку с упоминанием автора; страница без проекта с ИИ — без прогона', async () => {
    await put(w.member, { body: say('x ', bot) });
    answers = [result({ verdict: 'question', comment: 'Уточни', questions: ['Какой срок?'] })];
    await drain();
    const [, q] = await comments();
    expect(JSON.stringify(q!.body)).toContain('Какой срок?');
    expect(JSON.stringify(q!.body)).toContain(w.member.userId);
    const loose = uuidv7();
    await w.admin.ok('docs.page.create', {
      id: loose,
      spaceId: w.spaceId,
      rank: 'a1',
      title: 'Без проекта',
      body: doc('x'),
    });
    await w.admin.ok('docs.comment.create', { id: uuidv7(), pageId: loose, body: say('y ', bot) });
    await drain();
    expect(await raw(`select 1 from ai_runs where page_id = $1`, [loose])).toHaveLength(0);
  });
});

describe('события документа через действия пакета', () => {
  const mk = async (key: string, text: string, over: Record<string, unknown> = {}) => {
    const page = uuidv7();
    await w.admin.ok('docs.page.create', {
      id: page,
      spaceId: w.spaceId,
      projectId: P,
      rank: `b${key}`,
      title: `Инструкция ${key}`,
      body: doc(text),
    });
    await w.admin.ok('ai.action.create', {
      id: uuidv7(),
      projectId: P,
      key,
      name: `Действие ${key}`,
      pageId: page,
      runtime: 'llm',
      ...over,
    });
    return page;
  };
  const bind = async (events: Record<string, string>) =>
    raw(
      `insert into ai_harness_packs (id, project_id, pack_key, active, events) values ($1, $2, 'dev', true, $3)`,
      [uuidv7(), P, JSON.stringify(events)],
    );

  it('comment и mention: свой промпт, критерии и модель действия; без действия — DOC_SYSTEM', async () => {
    await mk('cmt', 'Инструкция-КОММЕНТ.', { model: 'm-comment', checks: ['критерий-А'] });
    await mk('men', 'Инструкция-УПОМИНАНИЕ.', { model: 'm-mention' });
    await bind({ comment: 'cmt', mention: 'men' });
    await put(w.member, { assigneeId: bot });
    await drain();
    expect(systems[0]).toContain('Инструкция-КОММЕНТ.');
    expect(systems[0]).toContain('критерий-А');
    expect(systems[0]).toContain('pagePatch');
    expect(models[0]).toBe('m-comment');
    await put(w.member, { body: say('x ', bot) });
    await drain();
    expect(systems[1]).toContain('Инструкция-УПОМИНАНИЕ.');
    expect(systems[1]).not.toContain('КОММЕНТ');
    expect(systems[1]).not.toContain('Критерии готовности');
    expect(models[1]).toBe('m-mention');
    await raw(`update ai_harness_packs set events = '{}' where project_id = $1`, [P]);
    await put(w.member, { body: say('y ', bot) });
    await drain();
    expect(systems[2]).not.toContain('# Инструкция');
    expect(models[2]).toBe('fake');
  });

  it('страница инструкции удалена: failed, ответ в ветку без resolve', async () => {
    const page = await mk('gone', 'Текст.');
    await bind({ comment: 'gone' });
    await raw(`update docs_pages set archived_at = now() where id = $1`, [page]);
    await put(w.member, { assigneeId: bot });
    await drain();
    expect(systems).toHaveLength(0);
    expect((await runs())[0]).toMatchObject({ state: 'failed' });
    const rows = await comments();
    expect(rows.filter((c) => c.resolved_at !== null)).toHaveLength(0);
    expect(JSON.stringify(rows.at(-1)!.body)).toContain('нет инструкции');
  });
});

describe('ИИ правит страницу патчем', () => {
  const bodyText = async () =>
    JSON.stringify((await one(`select body from docs_pages where id = $1`, [pageId])).body);
  const versions = async () =>
    (await raw(`select id from docs_versions where page_id = $1`, [pageId])).length;
  const patch = (find: string, replace: string) => ({ edits: [{ find, replace }] });

  it('успех: страница изменена, версия в истории, комментарий и resolve', async () => {
    const before = await versions();
    await put(w.member, { assigneeId: bot });
    answers = [result({ comment: 'Исправил', pagePatch: patch('Тело', 'Новое тело') })];
    await drain();
    expect(await bodyText()).toContain('Новое тело страницы.');
    expect(await versions()).toBe(before + 1);
    const [root, reply] = await comments();
    expect(root!.resolved_at).not.toBeNull();
    expect(reply!.author_id).toBe(bot);
    const [r] = await runs();
    expect(r).toMatchObject({ state: 'done' });
    expect(r!.log).toContain('версия');
  });

  it('patch_not_found и страница с упоминанием: страница не меняется, resolve нет, ответ с причиной', async () => {
    await put(w.member, { assigneeId: bot });
    answers = [result({ comment: 'Попытка', pagePatch: patch('нет такого', 'x') })];
    await drain();
    const [root, reply] = await comments();
    expect(root!.resolved_at).toBeNull();
    expect(JSON.stringify(reply!.body)).toContain('Изменения не применены');
    expect((await runs())[0]!.state).toBe('done');
    await w.admin.ok('docs.page.update', {
      id: pageId,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Тело ' },
              { type: 'mention', attrs: { id: w.member.userId } },
            ],
          },
        ],
      },
    });
    const withMention = await bodyText();
    const v = await versions();
    await put(w.member, { assigneeId: bot });
    answers = [result({ comment: 'Ещё', pagePatch: patch('Тело', 'Другое') })];
    await drain();
    expect(await bodyText()).toBe(withMention);
    expect(await versions()).toBe(v);
    const rows = await comments();
    expect(rows.filter((c) => c.resolved_at !== null)).toHaveLength(0);
    expect(JSON.stringify(rows.at(-1)!.body)).toContain('упоминания');
  });

  it('doc_mention: патч игнорируется', async () => {
    const before = await versions();
    await put(w.member, { body: say('поправь ', bot) });
    answers = [result({ comment: 'Ок', pagePatch: patch('Тело', 'Чужое') })];
    await drain();
    expect(await bodyText()).toContain('Тело страницы.');
    expect(await versions()).toBe(before);
    expect(JSON.stringify((await comments())[1]!.body)).toContain('игнорируются');
  });
});
