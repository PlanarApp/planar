// ai10 RUN-2: agent runs — start through ai-runner (a local fake, no docker), result, heartbeat, the LLM proxy,
// the reaper, replica limits, stop. The provider is a local fake too.
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
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import {
  dbUrl,
  doc,
  services,
  TestClient,
  useProject,
  world,
  type World,
} from '../sync/helpers.js';
import { key } from '../sync/helpers.js';

useApp();

const KEY_SECRET = 'sk-PROVIDER-SECRET';
let w: World;
let api: JobApi;
let bot: string;
let queue: PushQueue;
let runnerSrv: http.Server;
let provSrv: http.Server;
let cookie: string;
type Hit = {
  method: string;
  url: string;
  auth?: string;
  headers: http.IncomingHttpHeaders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fakes read free-form JSON
  body: Record<string, any>;
};
let runnerHits: Hit[] = [];
let provHits: Hit[] = [];
let runnerStatus = 201;
const jobs: { queue: string; data: Record<string, unknown>; opts?: Record<string, unknown> }[] = [];

const listen = (srv: http.Server) =>
  new Promise<string>((r) =>
    srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)),
  );
const serve = (hits: () => Hit[], reply: (h: Hit, res: http.ServerResponse) => void) =>
  http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const h = {
        method: req.method!,
        url: req.url!,
        auth: req.headers.authorization,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : {},
      };
      hits().push(h);
      reply(h, res);
    });
  });

const raw = (text: string, values: unknown[] = []) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test rows
  db.$client.query(text, values).then((r) => r.rows as Record<string, any>[]);
const one = async (text: string, values: unknown[] = []) => (await raw(text, values))[0]!;
const handler = (id: string, q: string) =>
  (
    installed.find((m) => m.api.id === id)!.api.jobs as {
      queue: string;
      handler(d: unknown, api: JobApi): Promise<void>;
    }[]
  ).find((j) => j.queue === q)!.handler;

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = randomBytes(32).toString('base64');
  w = await world(db);
  queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
  const svc = { ...services(db), push: new PushService(db, queue) };
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    w[c] = new TestClient(svc, w[c].userId);
  const capture = async (q: string, data: object, o?: object) =>
    void jobs.push({ queue: q, data: data as never, opts: o as never });
  queue.jobs.enqueue = capture;
  api = { ...(await queue.jobs.api()), enqueue: capture };
  cookie = await loginCookie(db, w.admin.userId);
  void createUser;
  runnerSrv = serve(
    () => runnerHits,
    (h, res) =>
      h.method === 'POST'
        ? res
            .writeHead(runnerStatus, { 'content-type': 'application/json' })
            .end(JSON.stringify({ containerId: 'c-1' }))
        : res.writeHead(204).end(),
  );
  provSrv = serve(
    () => provHits,
    (h, res) => {
      const anthropic = h.url.startsWith('/messages');
      if (h.body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (o: object) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        ev({ choices: [{ delta: { content: 'a' } }], usage: null });
        ev({ choices: [], usage: { prompt_tokens: 300, completion_tokens: 40 } });
        return void res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify(
          anthropic
            ? { type: 'message', usage: { input_tokens: 70, output_tokens: 30 } }
            : {
                // a request with tools gets a Gemini-like tool call with a thought signature
                choices: h.body.tools
                  ? [
                      {
                        message: {
                          tool_calls: [
                            {
                              id: 'call_1',
                              extra_content: { google: { thought_signature: 'S1' } },
                            },
                          ],
                        },
                      },
                    ]
                  : [],
                usage: { prompt_tokens: 1000, completion_tokens: 500 },
              },
        ),
      );
    },
  );
  process.env.AI_RUNNER_TOKEN = 'runner-token';
  process.env.AI_RUNNER_URL = await listen(runnerSrv);
  const base = await listen(provSrv);
  await raw(`delete from ai_connections`);
  await raw(
    `insert into ai_connections (id, scope, scope_id, provider, base_url, key_enc, model, price_in, price_out)
     values ($1, 'instance', '00000000-0000-0000-0000-000000000000', 'openai-compatible', $2, $3, 'fake', 1, 2)`,
    [uuidv7(), base, encrypt(KEY_SECRET, secretKey()!)],
  );
});
afterAll(async () => {
  runnerSrv.close();
  provSrv.close();
  await raw(`delete from ai_connections`);
  await queue.onApplicationShutdown();
  delete process.env.AI_RUNNER_URL;
});

let P: string;
let actionId: string;
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
  bot = (await one(`select id from users where login = 'ai' and bot`)).id;
  const pageId = uuidv7();
  await w.admin.ok('docs.page.create', {
    id: pageId,
    spaceId: w.spaceId,
    projectId: P,
    rank: 'a0',
    title: 'Агент',
    body: doc('Сделай работу.'),
  });
  actionId = uuidv7();
  await w.admin.ok('ai.action.create', {
    id: actionId,
    projectId: P,
    key: `k${actionId.slice(-6)}`,
    name: 'Агент',
    pageId,
    runtime: 'agent',
    checks: ['тесты зелёные'],
  });
  runnerHits = [];
  provHits = [];
  runnerStatus = 201;
  jobs.length = 0;
  process.env.AI_AGENT_MAX_REPLICAS = '50';
  delete process.env.AI_AGENT_TIMEOUT_MIN;
  delete process.env.AI_AGENT_HEARTBEAT_TIMEOUT_SEC;
  await raw(`update ai_runs set state = 'cancelled' where state = 'running'`);
});

async function start(project = P, action = actionId) {
  const id = uuidv7();
  await w.admin.ok('task.create', {
    id,
    projectId: project,
    statusId: (
      await one(`select id from statuses where project_id = $1 order by rank limit 1`, [project])
    ).id,
    title: 'Сделать',
    rank: 'a0',
    assignees: [{ id: uuidv7(), userId: bot }],
  });
  await handler('ai', 'ai.run')({ kind: 'action', taskId: id, actionId: action }, api);
  const run = (await raw(`select * from ai_runs where task_id = $1`, [id]))[0];
  const post = runnerHits.findLast((h) => h.method === 'POST' && h.body.runId === run?.id);
  return { taskId: id, run, secret: post?.body.env?.PLANAR_RUN_SECRET as string, post };
}
const call = (
  method: string,
  url: string,
  o: { secret?: string; body?: unknown; bearer?: boolean } = {},
) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url,
      payload: o.body as object | undefined,
      headers: o.secret
        ? o.bearer
          ? { authorization: `Bearer ${o.secret}` }
          : { 'x-api-key': o.secret }
        : {},
    });
const done = { verdict: 'done', comment: 'Сделано агентом' };

describe('agent: жизненный цикл', () => {
  it('старт → heartbeat → результат → done; секрет только в env контейнера и в виде sha256', async () => {
    const { run, secret, post, taskId } = await start();
    expect(run.state).toBe('running');
    expect(post!.auth).toBe('Bearer runner-token');
    expect(post!.body).toMatchObject({
      image: 'planar-ai-agent:latest',
      env: {
        PLANAR_RUN_ID: run.id,
        PLANAR_LLM_URL: `http://api:3000/api/ai/llm/${run.id}`,
        PLANAR_RESULT_URL: `http://api:3000/api/ai/runs/${run.id}`,
        PLANAR_HEARTBEAT_URL: `http://api:3000/api/ai/runs/${run.id}/heartbeat`,
        PLANAR_CONTEXT_FILE: '/context/context.json',
        NO_PROXY: 'api',
      },
    });
    expect(JSON.stringify(post!.body)).not.toContain(KEY_SECRET);
    const ctx = JSON.parse(post!.body.context);
    expect(ctx).toMatchObject({
      runId: run.id,
      action: { name: 'Агент', prompt: expect.stringContaining('Сделай работу') },
      checks: ['тесты зелёные'],
    });
    expect(run.agent_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.agent_secret_hash).not.toBe(secret);
    expect(run.container_id).toBe('c-1');

    expect((await call('POST', `/api/ai/runs/${run.id}/heartbeat`, { secret })).statusCode).toBe(
      204,
    );
    expect(
      (await one(`select heartbeat_at from ai_runs where id = $1`, [run.id])).heartbeat_at,
    ).not.toBeNull();

    const ok = await call('POST', `/api/ai/runs/${run.id}`, { secret, bearer: true, body: done });
    expect(ok.statusCode).toBe(200);
    const again = await call('POST', `/api/ai/runs/${run.id}`, { secret, body: done });
    expect(again.statusCode).toBe(409);
    const after = await one(`select * from ai_runs where id = $1`, [run.id]);
    expect(after.state).toBe('done');
    expect(
      (await raw(`select body from comments where task_id = $1`, [taskId]))
        .map((c) => JSON.stringify(c.body))
        .join(),
    ).toContain('Сделано агентом');
    for (const s of [ok.body, again.body, after.log, JSON.stringify(after)])
      expect(s).not.toContain(secret);
  });

  it('протокол LLM и модель; репозиторий gitlab — токен подключения в env, только при включённом модуле', async () => {
    const plain = await start();
    expect(plain.post!.body.env).toMatchObject({
      PLANAR_LLM_PROTOCOL: 'openai',
      PLANAR_LLM_MODEL: 'fake',
    });
    expect(plain.post!.body.env.GITLAB_TOKEN).toBeUndefined();
    await raw(
      `insert into gitlab_connections (id, project_id, base_url, token_enc, gitlab_project_id, path)
       values ($1, $2, 'https://gitlab.example/', $3, 7, 'acme/app')`,
      [uuidv7(), P, encrypt('glpat-secret', secretKey()!)],
    );
    const { post } = await start();
    expect(post!.body.env).toMatchObject({
      PLANAR_REPO_URL: 'https://gitlab.example/acme/app.git',
      GITLAB_HOST: 'gitlab.example',
      GITLAB_TOKEN: 'glpat-secret',
    });
    const ctx = JSON.parse(post!.body.context);
    expect(ctx.repo).toEqual({ url: 'https://gitlab.example/acme/app.git', path: 'acme/app' });
    expect(post!.body.context).not.toContain('glpat-secret');
    // the connection alone is not enough: the module is off in the project
    await raw(`update projects set modules = array_remove(modules, 'gitlab') where id = $1`, [P]);
    expect((await start()).post!.body.env.GITLAB_TOKEN).toBeUndefined();
  });

  it('неверный и чужой секрет — 401, прогон не меняется; без runner — fail', async () => {
    const a = await start();
    const b = await start();
    for (const [url, secret] of [
      [`/api/ai/runs/${a.run.id}/heartbeat`, b.secret],
      [`/api/ai/runs/${a.run.id}`, 'nope'],
      [`/api/ai/runs/${a.run.id}`, undefined],
      [`/api/ai/llm/${a.run.id}/v1/chat/completions`, b.secret],
    ] as const) {
      const r = await call('POST', url, { secret, body: done });
      expect(r.statusCode, url).toBe(401);
    }
    expect((await one(`select state from ai_runs where id = $1`, [a.run.id])).state).toBe(
      'running',
    );
    const url = process.env.AI_RUNNER_URL;
    delete process.env.AI_RUNNER_URL;
    const c = await start();
    process.env.AI_RUNNER_URL = url;
    expect(c.run.state).toBe('failed');
    expect(
      JSON.stringify(await raw(`select body from comments where task_id = $1`, [c.taskId])),
    ).toContain('Runner не настроен');
  });

  it('runner отказал — прогон failed, секрет не в логе', async () => {
    runnerStatus = 403;
    const r = await start();
    expect(r.run.state).toBe('failed');
    expect(r.run.log).toContain('runner: 403');
    expect(r.run.log).not.toContain(r.secret);
  });
});

describe('agent: лимиты реплик', () => {
  it('инстанс и проект: сверх лимита задание перепланируется (30 с), прогон не создаётся', async () => {
    process.env.AI_AGENT_MAX_REPLICAS = '1';
    const first = await start();
    expect(first.run.state).toBe('running');
    const second = await start();
    expect(second.run).toBeUndefined();
    expect(jobs.at(-1)).toMatchObject({
      queue: 'ai.run',
      opts: { startAfter: 30 },
      data: { kind: 'action', taskId: second.taskId },
    });
    expect(runnerHits.filter((h) => h.method === 'POST')).toHaveLength(1);
    // a finished run frees the place
    await call('POST', `/api/ai/runs/${first.run.id}`, { secret: first.secret, body: done });
    await handler('ai', 'ai.run')(jobs.at(-1)!.data, api);
    expect(
      (await raw(`select state from ai_runs where task_id = $1`, [second.taskId]))[0]!.state,
    ).toBe('running');

    process.env.AI_AGENT_MAX_REPLICAS = '50';
    await raw(`update ai_runs set state = 'cancelled' where state = 'running'`);
    await raw(`insert into ai_project_limits (project_id, max_agents) values ($1, 1)`, [P]);
    await start();
    const over = await start();
    expect(over.run).toBeUndefined();
    expect(jobs.at(-1)!.opts).toMatchObject({ startAfter: 30 });
    // another project is not held by this project's limit
    const Q = uuidv7();
    await w.admin.ok('project.create', {
      id: Q,
      spaceId: w.spaceId,
      name: 'Q',
      key: key(),
      rank: 'a1',
    });
    useProject(w, P);
    const page = uuidv7();
    await w.admin.ok('docs.page.create', {
      id: page,
      spaceId: w.spaceId,
      projectId: Q,
      rank: 'a0',
      title: 'Q',
      body: doc('x'),
    });
    const qa = uuidv7();
    await w.admin.ok('ai.action.create', {
      id: qa,
      projectId: Q,
      key: 'qq',
      name: 'A',
      pageId: page,
      runtime: 'agent',
    });
    expect((await start(Q, qa)).run.state).toBe('running');
  });
});

describe('agent: жнец и остановка', () => {
  it('нет heartbeat / превышено время → контейнер удалён (DELETE), прогон failed; живой не тронут', async () => {
    const stale = await start();
    const old = await start();
    const live = await start();
    await raw(`update ai_runs set heartbeat_at = now() - interval '10 minutes' where id = $1`, [
      stale.run.id,
    ]);
    await raw(
      `update ai_runs set heartbeat_at = now(), started_at = now() - interval '2 hours' where id = $1`,
      [old.run.id],
    );
    await raw(`update ai_runs set heartbeat_at = now() where id = $1`, [live.run.id]);
    await handler('ai', 'ai.agent.reap')({}, api);
    const st = async (id: string) =>
      (await one(`select state, log from ai_runs where id = $1`, [id])).state;
    expect(await st(stale.run.id)).toBe('failed');
    expect(await st(old.run.id)).toBe('failed');
    expect(await st(live.run.id)).toBe('running');
    const del = runnerHits.filter((h) => h.method === 'DELETE').map((h) => h.url);
    expect(del.sort()).toEqual([`/v1/runs/${stale.run.id}`, `/v1/runs/${old.run.id}`].sort());
    // no heartbeat at all: started_at counts
    await raw(
      `update ai_runs set started_at = now() - interval '5 minutes', heartbeat_at = null where id = $1`,
      [live.run.id],
    );
    await handler('ai', 'ai.agent.reap')({}, api);
    expect(await st(live.run.id)).toBe('failed');
    // a failed run takes no result
    expect(
      (await call('POST', `/api/ai/runs/${live.run.id}`, { secret: live.secret, body: done }))
        .statusCode,
    ).toBe(409);
  });

  it('воркер упал до записи хеша: прогон agent без секрета старше порога — failed; llm-прогон не трогается', async () => {
    const r = await start();
    await raw(
      `update ai_runs set agent_secret_hash = null, started_at = null, heartbeat_at = null,
       created_at = now() - interval '10 minutes' where id = $1`,
      [r.run.id],
    );
    await handler('ai', 'ai.agent.reap')({}, api);
    expect((await one(`select state from ai_runs where id = $1`, [r.run.id])).state).toBe('failed');
  });

  it('мусорный id в пути — 401, а не 500', async () => {
    for (const id of [
      'x',
      '0123456789012345678901234567890123456',
      'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
    ]) {
      expect((await call('POST', `/api/ai/runs/${id}/heartbeat`, { secret: 's' })).statusCode).toBe(
        401,
      );
    }
  });

  it('stop вызывает DELETE у runner; прогон cancelled и результат не принимается', async () => {
    const r = await start();
    const res = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/ai/runs/${r.run.id}/stop`,
        headers: { cookie, origin: ORIGIN },
      });
    expect(res.statusCode).toBe(204);
    expect(runnerHits.filter((h) => h.method === 'DELETE').map((h) => h.url)).toEqual([
      `/v1/runs/${r.run.id}`,
    ]);
    expect((await one(`select state from ai_runs where id = $1`, [r.run.id])).state).toBe(
      'cancelled',
    );
    expect(
      (await call('POST', `/api/ai/runs/${r.run.id}`, { secret: r.secret, body: done })).statusCode,
    ).toBe(409);
  });
});

describe('agent: LLM-прокси', () => {
  const chat = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

  it('подставляет ключ подключения, считает токены и стоимость (JSON и SSE)', async () => {
    const r = await start();
    const res = await call('POST', `/api/ai/llm/${r.run.id}/v1/chat/completions`, {
      secret: r.secret,
      body: chat,
    });
    expect(res.statusCode).toBe(200);
    expect(provHits[0]).toMatchObject({ url: '/chat/completions', auth: `Bearer ${KEY_SECRET}` });
    expect(provHits[0]!.headers['x-api-key']).toBeUndefined();
    expect(res.body).not.toContain(KEY_SECRET);
    let row = await one(`select input_tokens, output_tokens, cost from ai_runs where id = $1`, [
      r.run.id,
    ]);
    expect(row).toMatchObject({ input_tokens: 1000, output_tokens: 500 });
    expect(row.cost).toBeCloseTo(0.002, 9);

    const sse = await call('POST', `/api/ai/llm/${r.run.id}/v1/chat/completions`, {
      secret: r.secret,
      bearer: true,
      body: { ...chat, stream: true },
    });
    expect(sse.statusCode).toBe(200);
    expect(sse.body).toContain('[DONE]');
    expect(provHits[1]!.body.stream_options).toEqual({ include_usage: true });
    row = await one(`select input_tokens, output_tokens from ai_runs where id = $1`, [r.run.id]);
    expect(row).toMatchObject({ input_tokens: 1300, output_tokens: 540 });
  });

  it('Gemini: extra_content вызова инструмента возвращается в следующий запрос прогона', async () => {
    const r = await start();
    const post = (body: object) =>
      call('POST', `/api/ai/llm/${r.run.id}/v1/chat/completions`, { secret: r.secret, body });
    await post({ ...chat, tools: [{ type: 'function', function: { name: 'glob' } }] });
    const next = {
      ...chat,
      messages: [
        ...chat.messages,
        { role: 'assistant', tool_calls: [{ id: 'call_1' }, { id: 'call_2' }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'a.txt' },
      ],
    };
    await post(next);
    expect(provHits[1]!.body.messages[1].tool_calls).toEqual([
      { id: 'call_1', extra_content: { google: { thought_signature: 'S1' } } },
      { id: 'call_2' },
    ]);
    // another run does not see the signatures of this one
    const other = await start();
    await call('POST', `/api/ai/llm/${other.run.id}/v1/chat/completions`, {
      secret: other.secret,
      body: next,
    });
    expect(provHits[2]!.body.messages[1].tool_calls[0]).toEqual({ id: 'call_1' });
  });

  it('anthropic: ключ в x-api-key, usage input/output_tokens', async () => {
    await raw(`update ai_connections set provider = 'anthropic'`);
    try {
      const r = await start();
      const res = await call('POST', `/api/ai/llm/${r.run.id}/v1/messages?beta=true`, {
        secret: r.secret,
        body: chat,
      });
      expect(res.statusCode).toBe(200);
      expect(provHits[0]).toMatchObject({ url: '/messages?beta=true' });
      expect(provHits[0]!.headers['x-api-key']).toBe(KEY_SECRET);
      expect(provHits[0]!.headers['anthropic-version']).toBe('2023-06-01');
      expect(
        await one(`select input_tokens, output_tokens from ai_runs where id = $1`, [r.run.id]),
      ).toMatchObject({ input_tokens: 70, output_tokens: 30 });
    } finally {
      await raw(`update ai_connections set provider = 'openai-compatible'`);
    }
  });

  it('чужой путь — 404 без пересылки; лимит проекта исчерпан — 429 без пересылки', async () => {
    const r = await start();
    for (const p of ['/v1/models', '/v1/embeddings', '/']) {
      expect(
        (await call('POST', `/api/ai/llm/${r.run.id}${p}`, { secret: r.secret, body: chat }))
          .statusCode,
        p,
      ).toBe(404);
    }
    expect(provHits).toHaveLength(0);
    await raw(`insert into ai_project_limits (project_id, daily_tokens) values ($1, 100)`, [P]);
    await raw(`update ai_runs set input_tokens = 200 where id = $1`, [r.run.id]);
    const res = await call('POST', `/api/ai/llm/${r.run.id}/v1/chat/completions`, {
      secret: r.secret,
      body: chat,
    });
    expect(res.statusCode).toBe(429);
    expect(provHits).toHaveLength(0);
    expect(res.body).not.toContain(KEY_SECRET);
  });
});
