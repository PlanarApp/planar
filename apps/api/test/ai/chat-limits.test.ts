// Limits of a chat run (AI_CHAT_MAX_STEPS, AI_CHAT_MAX_TOKENS): the fake provider calls a read tool in a loop.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  taskArgs,
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
type Job = { queue: string; data: Record<string, unknown> };
const jobs: Job[] = [];
/** the tool call the fake provider makes on the first request of a run (null — just text) */
let script: { name: string; args: object } | null = null;
let systems: string[] = [];
let requests = 0;
let perStep = 15;

const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const aiHandler = (
  installed.find((m) => m.api.id === 'ai')!.api.jobs as {
    queue: string;
    handler(d: unknown, api: JobApi): Promise<void>;
  }[]
).find((j) => j.queue === 'ai.run')!.handler;
async function drain() {
  for (let i = 0; i < 20 && jobs.length; i++) {
    const j = jobs.shift()!;
    if (j.queue === 'ai.run') await aiHandler(j.data, api);
  }
}
const send = async (c: TestClient, channelId: string, text: string, over: object = {}) => {
  const id = uuidv7();
  await c.ok('chat.message.send', {
    id,
    channelId,
    body: doc(text),
    readId: uuidv7(),
    ...over,
  });
  return id;
};
const botTexts = async (channelId: string) =>
  (
    await raw(
      `select body from chat_messages where channel_id = $1 and author_id = $2 order by created_at`,
      [channelId, bot],
    )
  ).map((r) => JSON.stringify(r.body));
const runs = () => raw(`select * from ai_runs where kind = 'chat' order by created_at, id`);

const completion = (message: object, finish: string) =>
  JSON.stringify({
    id: 'c1',
    object: 'chat.completion',
    created: 1,
    model: 'fake',
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: { prompt_tokens: perStep - 5, completion_tokens: 5, total_tokens: perStep },
  });

let a: string;
let b: string;
let linkId: string;
let channel: string;

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
  await new TestClient(svc, await mkUser(db, 'admin')).ok('settings.set', {
    id: 'enabled_modules',
    value: ['chat', 'ai'],
  });
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages;
      systems.push(m.find((x) => x.role === 'system')?.content ?? '');
      requests++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        completion(
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 't1',
                type: 'function',
                function: { name: script.name, arguments: JSON.stringify(script.args) },
              },
            ],
          },
          'tool_calls',
        ),
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
  await queue.onApplicationShutdown();
  await db.$client.end();
});

beforeEach(async () => {
  jobs.length = 0;
  script = { name: 'ai_list_packs', args: { projectId: w.projectId } };
  systems = [];
  requests = 0;
  perStep = 15;
  await raw(`delete from ai_runs where kind = 'chat'`);
  const ta = taskArgs(w, { title: 'A' });
  const tb = taskArgs(w, { title: 'B' });
  await w.admin.ok('task.create', ta);
  await w.admin.ok('task.create', tb);
  a = ta.id;
  b = tb.id;
  linkId = uuidv7();
  await w.admin.ok('link.create', { id: linkId, taskId: a, targetId: b, kind: 'relates' });
  channel = uuidv7();
  await w.admin.ok('chat.channel.create', { id: channel, spaceId: w.spaceId, name: 'team' });
});

const dialog = async (c: TestClient, userId: string) => {
  const id = uuidv7();
  await c.ok('chat.dm.create', {
    id,
    members: [userId, bot].map((u) => ({ id: uuidv7(), userId: u })),
  });
  return id;
};

afterEach(() => {
  delete process.env.AI_CHAT_MAX_STEPS;
  delete process.env.AI_CHAT_MAX_TOKENS;
});

describe('Чат: лимиты прогона', () => {
  const ask = async () => {
    const dm = await dialog(w.admin, w.admin.userId);
    await send(w.admin, dm, 'пакеты?');
    await drain();
    return dm;
  };

  it('AI_CHAT_MAX_STEPS=2: два шага, прогон завершён, ответ — «…»', async () => {
    process.env.AI_CHAT_MAX_STEPS = '2';
    const dm = await ask();
    expect(requests).toBe(2);
    expect(await runs()).toMatchObject([{ state: 'done' }]);
    expect((await botTexts(dm)).join()).toContain('…');
  });

  it('по умолчанию 10 шагов; не число — по умолчанию', async () => {
    process.env.AI_CHAT_MAX_STEPS = 'abc';
    await ask();
    expect(requests).toBe(10);
  });

  it('AI_CHAT_MAX_TOKENS: стоп после превышения суммы по шагам', async () => {
    process.env.AI_CHAT_MAX_TOKENS = '40';
    await ask();
    // 15 per step: 15, 30, 45 >= 40
    expect(requests).toBe(3);
    expect(await runs()).toMatchObject([{ state: 'done' }]);
  });
});
