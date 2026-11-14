import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dockerClient, tar } from '../src/docker.js';
import { createRunner, sweepWork, type Config } from '../src/server.js';

type Call = { method: string; url: string; body: string };
type Ctr = { Id: string; Labels: Record<string, string>; running: boolean; exitCode: number };

const RUN = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'secret-token';
const IMAGE = 'registry.example/agent:1';

let dir: string;
let cfg: Config;
let fake: Server;
let runner: Server;
let base: string;
let calls: Call[];
let ctrs: Ctr[];
let failStart = false;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ai-runner-'));
  const sock = join(dir, 'docker.sock');
  // a stand-in for the docker Engine API: only the endpoints the runner uses
  fake = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const url = req.url ?? '';
      calls.push({ method: req.method ?? '', url, body });
      const json = (s: number, o?: unknown) => {
        res.writeHead(s, { 'content-type': 'application/json' });
        res.end(o === undefined ? undefined : JSON.stringify(o));
      };
      const id = /^\/containers\/([^/?]+)/.exec(url)?.[1];
      if (req.method === 'GET' && url.startsWith('/containers/json')) {
        const label = (
          JSON.parse(new URL(url, 'http://x').searchParams.get('filters')!) as {
            label: string[];
          }
        ).label[0];
        return json(
          200,
          ctrs.filter((c) => `planar.ai.run=${c.Labels['planar.ai.run']}` === label),
        );
      }
      if (req.method === 'POST' && url.startsWith('/containers/create')) {
        const parsed = JSON.parse(body) as { Labels: Record<string, string> };
        const c = { Id: 'cid-1', Labels: parsed.Labels, running: false, exitCode: 0 };
        ctrs.push(c);
        return json(201, { Id: c.Id });
      }
      if (req.method === 'PUT' && url.endsWith('/archive?path=/context')) return json(200);
      if (req.method === 'POST' && url.endsWith('/start'))
        return failStart ? json(500, { message: 'boom' }) : json(204);
      if (req.method === 'GET' && url.endsWith('/json')) {
        const c = ctrs.find((x) => x.Id === id);
        return c ? json(200, { State: { Running: c.running, ExitCode: c.exitCode } }) : json(404);
      }
      if (req.method === 'DELETE') {
        ctrs = ctrs.filter((x) => x.Id !== id);
        return json(204);
      }
      json(404);
    });
  });
  await new Promise<void>((r) => fake.listen(sock, r));
  cfg = {
    token: TOKEN,
    images: [IMAGE],
    maxCpus: 2,
    maxMemoryMb: 4096,
    maxPids: 512,
    agentNetwork: 'planar_agents',
    workDir: join(dir, 'work'),
    workHostDir: '/host/ai-work',
  };
  runner = createRunner(cfg, dockerClient(sock));
  await new Promise<void>((r) => runner.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(runner.address() as AddressInfo).port}`;
});

afterAll(() => {
  runner.close();
  fake.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  ctrs = [];
  failStart = false;
  rmSync(join(dir, 'work'), { recursive: true, force: true });
});
const workOf = (runId: string) => join(dir, 'work', runId);

const api = (method: string, path: string, body?: unknown, token: string | null = TOKEN) =>
  fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (body: object) => api('POST', '/v1/runs', { runId: RUN, image: IMAGE, ...body });

describe('ai-runner', () => {
  it('healthz без токена', async () => {
    expect((await api('GET', '/healthz', undefined, null)).status).toBe(200);
  });

  it('401 без токена и с чужим токеном, docker не трогали', async () => {
    expect((await api('POST', '/v1/runs', {}, null)).status).toBe(401);
    expect((await api('GET', `/v1/runs/${RUN}`, undefined, 'nope')).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('создаёт контейнер с фиксированным HostConfig, кладёт контекст, стартует', async () => {
    const r = await post({
      env: { PLANAR_RUN_ID: RUN, A_1: 'x' },
      limits: { cpus: 1.5, memoryMb: 1024, pids: 100 },
      context: '{"runId":"x"}',
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ containerId: 'cid-1' });
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      'GET /containers/json',
      'POST /containers/create',
      'PUT /containers/cid-1/archive',
      'POST /containers/cid-1/start',
    ]);
    const create = calls[1];
    expect(create.url).toContain(`name=planar-ai-run-${RUN}`);
    const body = JSON.parse(create.body);
    expect(body.Image).toBe(IMAGE);
    expect(body.Env).toEqual([`PLANAR_RUN_ID=${RUN}`, 'A_1=x']);
    expect(body.Labels).toEqual({ 'planar.ai.run': RUN });
    expect(body.HostConfig).toEqual({
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: true,
      Mounts: [
        { Type: 'volume', Target: '/context' },
        { Type: 'bind', Source: `/host/ai-work/${RUN}`, Target: '/work' },
      ],
      AutoRemove: true,
      Tmpfs: { '/tmp': 'rw,nosuid,size=256m' },
      NetworkMode: 'planar_agents',
      RestartPolicy: { Name: 'no' },
      Memory: 1024 * 1024 * 1024,
      MemorySwap: 1024 * 1024 * 1024,
      NanoCpus: 1.5e9,
      PidsLimit: 100,
    });
    for (const k of ['Binds', 'Privileged', 'PidMode'])
      expect(body.HostConfig).not.toHaveProperty(k);
    expect(statSync(workOf(RUN)).mode & 0o777).toBe(0o777);
    expect(calls[2].url).toContain('path=/context');
    expect(calls[2].body).toContain('context.json');
    expect(calls[2].body).toContain('{"runId":"x"}');
  });

  it('умолчания лимитов: 1 CPU, 2048 МБ, 256 pids; клиентский HostConfig игнорируется', async () => {
    const r = await post({ HostConfig: { Privileged: true, Binds: ['/:/host'] } });
    expect(r.status).toBe(201);
    const hc = JSON.parse(calls[1].body).HostConfig;
    expect(hc).toMatchObject({ NanoCpus: 1e9, Memory: 2048 * 1024 * 1024, PidsLimit: 256 });
    expect(hc).not.toHaveProperty('Privileged');
    expect(hc).not.toHaveProperty('Binds');
    expect(calls.map((c) => c.method)).not.toContain('PUT'); // no context — no archive
  });

  it('403 для образа вне allowlist (точное совпадение), docker не трогали', async () => {
    for (const image of ['other/image', `${IMAGE}x`, 'registry.example/agent']) {
      const r = await post({ image });
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: 'image_not_allowed' });
    }
    expect(calls).toEqual([]);
  });

  it('400: потолки, плохие env, runId, контекст', async () => {
    const cases: object[] = [
      { limits: { cpus: 3 } },
      { limits: { memoryMb: 4097 } },
      { limits: { pids: 513 } },
      { limits: { cpus: 0 } },
      { limits: { pids: 1.5 } },
      { env: { lower: 'x' } },
      { env: { A: 1 } },
      { env: { A: 'x'.repeat(16 * 1024 + 1) } },
      { env: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`V${i}`, 'x'])) },
      { context: 'x'.repeat(1024 * 1024 + 1) },
      { context: 5 },
      { runId: 'not-a-uuid' },
    ];
    for (const c of cases) expect((await post(c)).status, JSON.stringify(c).slice(0, 60)).toBe(400);
    expect((await api('POST', '/v1/runs', 'not json')).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('409, если контейнер с меткой runId уже есть', async () => {
    expect((await post({})).status).toBe(201);
    expect((await post({})).status).toBe(409);
  });

  it('413 на тело больше 2 МБ', async () => {
    expect((await post({ context: 'x'.repeat(2 * 1024 * 1024) })).status).toBe(413);
  });

  it('ошибка старта: контейнер удаляется, ответ 502', async () => {
    failStart = true;
    expect((await post({})).status).toBe(502);
    expect(calls.at(-1)).toMatchObject({
      method: 'DELETE',
      url: '/containers/cid-1?force=true&v=true',
    });
    expect(ctrs).toEqual([]);
    expect(existsSync(workOf(RUN))).toBe(false);
  });

  it('GET: running / exited с кодом / 404', async () => {
    expect((await api('GET', `/v1/runs/${RUN}`)).status).toBe(404);
    await post({});
    ctrs[0].running = true;
    expect(await (await api('GET', `/v1/runs/${RUN}`)).json()).toEqual({ state: 'running' });
    ctrs[0].running = false;
    ctrs[0].exitCode = 3;
    expect(await (await api('GET', `/v1/runs/${RUN}`)).json()).toEqual({
      state: 'exited',
      exitCode: 3,
    });
  });

  it('DELETE: force-remove, каталог /work удалён, идемпотентно', async () => {
    await post({});
    expect(existsSync(workOf(RUN))).toBe(true);
    expect((await api('DELETE', `/v1/runs/${RUN}`)).status).toBe(204);
    expect(ctrs).toEqual([]);
    expect(existsSync(workOf(RUN))).toBe(false);
    expect((await api('DELETE', `/v1/runs/${RUN}`)).status).toBe(204);
  });

  it('очистка /work: удаляет старые каталоги без контейнера, живые и свежие не трогает', async () => {
    const live = '22222222-2222-4222-8222-222222222222';
    const gone = '33333333-3333-4333-8333-333333333333';
    const fresh = '44444444-4444-4444-8444-444444444444';
    ctrs.push({ Id: 'cid-live', Labels: { 'planar.ai.run': live }, running: true, exitCode: 0 });
    const old = new Date(Date.now() - 3600_000);
    for (const id of [live, gone, fresh, 'not-a-run']) mkdirSync(workOf(id), { recursive: true });
    for (const id of [live, gone, 'not-a-run']) utimesSync(workOf(id), old, old);
    await sweepWork(cfg, dockerClient(join(dir, 'docker.sock')));
    expect([live, gone, fresh, 'not-a-run'].map((id) => existsSync(workOf(id)))).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it('недоступный docker — 502', async () => {
    const dead = createRunner(
      {
        token: TOKEN,
        images: [IMAGE],
        maxCpus: 2,
        maxMemoryMb: 4096,
        maxPids: 512,
        agentNetwork: 'n',
        workDir: join(dir, 'work'),
        workHostDir: '/host/ai-work',
      },
      dockerClient(join(dir, 'missing.sock')),
    );
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const port = (dead.address() as AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${port}/v1/runs/${RUN}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    dead.close();
    expect(r.status).toBe(502);
  });
});

describe('tar', () => {
  it('каталог и файл: блоки по 512, контрольные суммы, размер', () => {
    const t = tar([
      { name: 'context/' },
      { name: 'context/context.json', data: Buffer.from('hello') },
    ]);
    expect(t.length).toBe(512 * 3 + 1024);
    const check = (off: number) => {
      const h = Buffer.from(t.subarray(off, off + 512));
      const stored = parseInt(h.toString('ascii', 148, 154), 8);
      h.fill(0x20, 148, 156);
      expect([...h].reduce((a, b) => a + b, 0)).toBe(stored);
      return h;
    };
    const d = check(0);
    expect(d.toString('ascii', 0, 8)).toBe('context/');
    expect(d.toString('ascii', 156, 157)).toBe('5');
    const f = check(512);
    expect(f.toString('ascii', 0, 20)).toBe('context/context.json');
    expect(parseInt(f.toString('ascii', 124, 135), 8)).toBe(5);
    expect(t.toString('ascii', 1024, 1029)).toBe('hello');
  });
});
