// AIC-2: the bot answers chat messages — a dialog with the bot always, a channel only on a quote / @ai.
// The provider is a local fake of an OpenAI-compatible server: a plain text answer.
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
  mkUser,
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
let channel: string;
type Job = { queue: string; data: Record<string, unknown> };
const jobs: Job[] = [];
let prompts: { system: string; prompt: string }[] = [];

const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const aiHandler = (
  installed.find((m) => m.api.id === 'ai')!.api.jobs as {
    queue: string;
    handler(d: unknown, api: JobApi): Promise<void>;
  }[]
).find((j) => j.queue === 'ai.run')!.handler;

/** Runs the queued ai.run jobs (the bot's answer is not a trigger: no loop). */
async function drain() {
  for (let i = 0; i < 20 && jobs.length; i++) {
    const j = jobs.shift()!;
    if (j.queue === 'ai.run') await aiHandler(j.data, api);
  }
}
const send = async (c: TestClient, channelId: string, over: Record<string, unknown> = {}) => {
  const id = uuidv7();
  await c.ok('chat.message.send', {
    id,
    channelId,
    body: doc('Привет'),
    readId: uuidv7(),
    ...over,
  });
  return id;
};
const mentionBody = (id: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label: 'ai' } },
        { type: 'text', text: ' помоги' },
      ],
    },
  ],
});
const botMessages = (channelId: string) =>
  raw(`select * from chat_messages where channel_id = $1 and author_id = $2 order by created_at`, [
    channelId,
    bot,
  ]);
const chatRuns = () => raw(`select * from ai_runs where kind = 'chat' order by created_at, id`);
const chatJobs = () => jobs.filter((j) => j.queue === 'ai.run' && j.data.kind === 'chat');

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
  const iadmin = new TestClient(svc, await mkUser(db, 'admin'));
  await iadmin.ok('settings.set', { id: 'enabled_modules', value: ['chat', 'ai'] });
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages;
      prompts.push({
        system: m.find((x) => x.role === 'system')?.content ?? '',
        prompt: m.find((x) => x.role === 'user')?.content ?? '',
      });
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'fake',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Ответ ИИ' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  await raw(`delete from ai_connections`);
  await db.$client.query(
    `insert into ai_connections (id, scope, scope_id, provider, base_url, key_enc, model)
     values ($1, 'workspace', '00000000-0000-0000-0000-000000000000', 'openai-compatible', $2, $3, 'fake')`,
    [uuidv7(), base, encrypt('sk-test', secretKey()!)],
  );
  // a project with the module: the bot exists and is a member of the space
  const P = uuidv7();
  await w.admin.ok('project.create', {
    id: P,
    spaceId: w.spaceId,
    name: 'AI',
    key: key(),
    rank: 'a0',
  });
  useProject(w, P);
  bot = (await raw(`select id from users where login = 'ai' and bot`))[0]!.id as string;
});
afterAll(async () => {
  srv.close();
  await raw(`delete from ai_connections`);
  await raw(`delete from ai_settings`);
  await queue.onApplicationShutdown();
  await db.$client.end();
});

beforeEach(async () => {
  jobs.length = 0;
  prompts = [];
  await raw(`delete from ai_settings`);
  await raw(`delete from ai_runs where kind = 'chat'`);
  channel = uuidv7();
  await w.member.ok('chat.channel.create', { id: channel, spaceId: w.spaceId, name: 'general' });
});

const dialog = async (users: string[]) => {
  const id = uuidv7();
  await w.member.ok('chat.dm.create', {
    id,
    members: users.map((userId) => ({ id: uuidv7(), userId })),
  });
  return id;
};

describe('Чат с ботом', () => {
  it('личный чат: сообщение человека — ответ бота с контекстом; ответ бота цикла не даёт', async () => {
    const dm = await dialog([w.member.userId, bot]);
    await send(w.member, dm, { body: doc('Сколько будет 2+2?') });
    expect(chatJobs()).toHaveLength(1);
    await drain();
    const [reply] = await botMessages(dm);
    expect(reply).toMatchObject({ parent_id: null });
    expect(JSON.stringify(reply!.body)).toContain('Ответ ИИ');
    expect(prompts[0]!.prompt).toContain('Сколько будет 2+2?');
    expect(chatJobs()).toHaveLength(0);
    expect(await chatRuns()).toMatchObject([{ state: 'done', input_tokens: 10, output_tokens: 5 }]);
  });

  it('диалог людей без бота молчит; диалог из трёх с ботом — только по @ai', async () => {
    const humans = await dialog([w.member.userId, w.admin.userId]);
    await send(w.member, humans);
    expect(chatJobs()).toHaveLength(0);
    const group = await dialog([w.member.userId, w.admin.userId, bot]);
    await send(w.member, group);
    expect(chatJobs()).toHaveLength(0);
    await send(w.member, group, { body: mentionBody(bot) });
    expect(chatJobs()).toHaveLength(1);
  });

  it('групповой канал: без цитирования молчит; @ai и ответ на сообщение бота — отвечает в треде', async () => {
    await send(w.member, channel);
    expect(chatJobs()).toHaveLength(0);
    const asked = await send(w.member, channel, { body: mentionBody(bot) });
    expect(chatJobs()).toHaveLength(1);
    await drain();
    const [first] = await botMessages(channel);
    expect(first).toMatchObject({ parent_id: asked });
    // a reply in the thread of the bot's message → another answer
    await send(w.admin, channel, { parentId: asked, body: doc('а подробнее?') });
    expect(chatJobs()).toHaveLength(0); // the root is the person's message: not a quote of the bot
    const root = await send(w.admin, channel, { body: doc('вопрос') });
    await raw(`update chat_messages set author_id = $1 where id = $2`, [bot, root]);
    await send(w.member, channel, { parentId: root, body: doc('уточняю') });
    expect(chatJobs()).toHaveLength(1);
  });

  it('дубль доставки не даёт второго прогона', async () => {
    const dm = await dialog([w.member.userId, bot]);
    const id = await send(w.member, dm);
    await drain();
    await aiHandler(
      { kind: 'chat', messageId: id, channelId: dm, initiatorId: w.member.userId },
      api,
    );
    expect(await chatRuns()).toHaveLength(1);
    expect(await botMessages(dm)).toHaveLength(1);
  });

  it('выключатель: вызова ИИ нет, бот отвечает причиной', async () => {
    await raw(`insert into ai_settings (id, enabled) values (1, false)`);
    const dm = await dialog([w.member.userId, bot]);
    await send(w.member, dm);
    await drain();
    expect(prompts).toHaveLength(0);
    expect(JSON.stringify((await botMessages(dm))[0]!.body)).toContain('выключен');
    expect(await chatRuns()).toMatchObject([{ state: 'failed' }]);
  });
});
