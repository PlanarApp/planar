// AIC-3: the chat run has the tools of the initiator; a dangerous call waits for the initiator's «да» (stored in the DB).
// The provider is a local fake of an OpenAI-compatible server: a scripted tool call, then a text answer.
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
let toolResults: string[] = [];

const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const aiHandler = (
  installed.find((m) => m.api.id === 'ai')!.api.jobs as {
    queue: string;
    handler(d: unknown, api: JobApi): Promise<void>;
  }[]
).find((j) => j.queue === 'ai.run')!.handler;
const aiJobs = () => jobs.filter((j) => j.queue === 'ai.run');
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
const mention = (id: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label: 'ai' } },
        { type: 'text', text: ' удали связь' },
      ],
    },
  ],
});
const botTexts = async (channelId: string) =>
  (
    await raw(
      `select body from chat_messages where channel_id = $1 and author_id = $2 order by created_at`,
      [channelId, bot],
    )
  ).map((r) => JSON.stringify(r.body));
const runs = () => raw(`select * from ai_runs where kind = 'chat' order by created_at, id`);
const links = (id: string) => raw(`select 1 from task_links where id = $1`, [id]);

const completion = (message: object, finish: string) =>
  JSON.stringify({
    id: 'c1',
    object: 'chat.completion',
    created: 1,
    model: 'fake',
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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
    value: ['chat'],
  });
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages;
      systems.push(m.find((x) => x.role === 'system')?.content ?? '');
      const tool = m.filter((x) => x.role === 'tool').at(-1);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (tool) {
        toolResults.push(tool.content);
        return res.end(completion({ role: 'assistant', content: 'Готовлю действие' }, 'stop'));
      }
      if (!script) return res.end(completion({ role: 'assistant', content: 'Ответ ИИ' }, 'stop'));
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
  script = { name: 'unlink_tasks', args: {} };
  systems = [];
  toolResults = [];
  await raw(`delete from ai_runs where kind = 'chat'`);
  const ta = taskArgs(w, { title: 'A' });
  const tb = taskArgs(w, { title: 'B' });
  await w.admin.ok('task.create', ta);
  await w.admin.ok('task.create', tb);
  a = ta.id;
  b = tb.id;
  linkId = uuidv7();
  await w.admin.ok('link.create', { id: linkId, taskId: a, targetId: b, kind: 'relates' });
  script.args = { id: linkId };
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

describe('Чат: подтверждение «да»', () => {
  it('опасный вызов не выполняется; ждёт «да»; «да» автора выполняет от него и закрывает прогон', async () => {
    const dm = await dialog(w.admin, w.admin.userId);
    await send(w.admin, dm, 'удали связь');
    await drain();
    expect(await links(linkId)).toHaveLength(1);
    expect(toolResults.join()).toContain('needsConfirmation');
    expect(await runs()).toMatchObject([{ state: 'waiting_human' }]);
    expect((await botTexts(dm)).join()).toContain('План действий');
    // a restart: the plan is in the DB, nothing is executed without «да»
    await send(w.admin, dm, 'Да.');
    // the «да» is not a question for the bot: only the confirm job
    expect(aiJobs().map((j) => j.data.kind)).toEqual(['confirm']);
    await drain();
    expect(await links(linkId)).toHaveLength(0);
    expect(await runs()).toMatchObject([{ state: 'done', pending: null }]);
    expect((await botTexts(dm)).join()).toContain('Выполнено: unlink_tasks');
  });

  it('выключатель ИИ: «да» после выключения не выполняет план, прогон отменён', async () => {
    const dm = await dialog(w.admin, w.admin.userId);
    await send(w.admin, dm, 'удали связь');
    await drain();
    await raw(`insert into ai_settings (id, enabled) values (1, false)`);
    try {
      await send(w.admin, dm, 'да');
      await drain();
    } finally {
      await raw(`delete from ai_settings`);
    }
    expect(await links(linkId)).toHaveLength(1);
    expect(await runs()).toMatchObject([{ state: 'cancelled' }]);
  });

  it('«да» второй раз ничего не делает; не «да» — отмена', async () => {
    const dm = await dialog(w.admin, w.admin.userId);
    await send(w.admin, dm, 'удали связь');
    await drain();
    await send(w.admin, dm, 'не надо');
    jobs.length = 0;
    expect(await runs()).toMatchObject([{ state: 'cancelled' }]);
    await send(w.admin, dm, 'да');
    await drain();
    expect(await links(linkId)).toHaveLength(1);
  });

  it('группа: «да» другого человека не считается, «да» инициатора — выполняет', async () => {
    const asked = await send(w.admin, channel, '', { body: mention(bot) });
    await drain();
    expect(await runs()).toMatchObject([{ state: 'waiting_human' }]);
    await send(w.member, channel, 'да', { parentId: asked });
    expect(aiJobs()).toHaveLength(0);
    expect(await runs()).toMatchObject([{ state: 'waiting_human' }]);
    // outside the thread — not an answer either
    await send(w.admin, channel, 'да');
    expect(aiJobs()).toHaveLength(0);
    await send(w.admin, channel, 'да', { parentId: asked });
    await drain();
    expect(await links(linkId)).toHaveLength(0);
    expect(await runs()).toMatchObject([{ state: 'done' }]);
  });

  it('права: цитирует гость проекта — отказ результатом, без эскалации; бот пояснил', async () => {
    script = { name: 'update_task', args: { task: a, title: 'Взлом' } };
    await send(w.guest, channel, '', { body: mention(bot) });
    await drain();
    expect(toolResults.join()).toMatch(/forbidden|not_found/);
    expect(await raw(`select title from tasks where id = $1`, [a])).toMatchObject([{ title: 'A' }]);
    expect(await runs()).toMatchObject([{ state: 'done' }]);
    expect(await botTexts(channel)).toHaveLength(1);
  });

  it('промпт «Чат»: запасной без пакета; инструкция «Чат» активного пакета проекта — с ним', async () => {
    script = null;
    const dm = await dialog(w.admin, w.admin.userId);
    await send(w.admin, dm, 'привет');
    await drain();
    expect(systems[0]).toContain('needsConfirmation');
    const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
    const page = async (title: string, body: object, parentId?: string) => {
      const id = uuidv7();
      await w.admin.ok('docs.page.create', {
        id,
        spaceId: w.spaceId,
        projectId: w.projectId,
        parentId,
        rank: 'a0',
        title,
        body,
      });
      return id;
    };
    const root = await page('Пакет', {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'yaml harness.yml' },
          content: [{ type: 'text', text: 'actions: []' }],
        },
      ],
    });
    await page('Чат', { type: 'doc', content: [p('Отвечай как пират ПИРАТ-42.')] }, root);
    await raw(
      `insert into ai_harness_packs (id, project_id, pack_key, active, root_page_id) values ($1, $2, 'dev', true, $3)`,
      [uuidv7(), w.projectId, root],
    );
    // a dialog has no project: the prompt comes with a channel of the project
    const pc = uuidv7();
    await w.admin.ok('chat.channel.create', {
      id: pc,
      spaceId: w.spaceId,
      projectId: w.projectId,
      name: 'proj',
    });
    systems = [];
    await send(w.admin, pc, '', { body: mention(bot) });
    await drain();
    expect(systems[0]).toContain('ПИРАТ-42');

    // events chosen (PLNRAPP-198): the action of `chat` wins over the page «Чат»; no `chat` — the built-in prompt
    const k = `c${uuidv7().slice(-6)}`;
    await w.admin.ok('ai.action.create', {
      id: uuidv7(),
      projectId: w.projectId,
      key: k,
      name: 'Чат проекта',
      pageId: await page('Чат проекта', { type: 'doc', content: [p('Ты робот РОБОТ-9.')] }, root),
      runtime: 'llm',
    });
    for (const [events, want] of [
      [{ chat: k }, 'РОБОТ-9'],
      [{}, 'needsConfirmation'],
    ] as const) {
      await raw(`update ai_harness_packs set events = $1 where project_id = $2`, [
        JSON.stringify(events),
        w.projectId,
      ]);
      systems = [];
      await send(w.admin, pc, '', { body: mention(bot) });
      await drain();
      expect(systems[0]).toContain(want);
      expect(systems[0]).not.toContain('ПИРАТ-42');
    }
    await raw(`delete from ai_harness_packs where project_id = $1`, [w.projectId]);
  });
});
