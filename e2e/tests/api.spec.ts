import { expect, request, test } from '@playwright/test';
import { BASE, Client, Ws, ranks, uuidv7, type Data } from '../lib.js';

// Scenarios run in order and share data: private space of admin, then permissions, queue, realtime.
test.describe.configure({ mode: 'serial' });

let admin: Client, alice: Client, bob: Client;
const spaceId = uuidv7();
const projectId = uuidv7();
const taskId = uuidv7();
let statusIds: string[];
let sha: string;
let bobCursor = 0;
let aliceCursor = 0;

// project keys are unique, and the database lives between runs: take random ones
const key = () =>
  Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
    '',
  );
const ids = (d: Data, e: string) => (d[e] ?? []).map((r) => r.id);

test.beforeAll(async () => {
  [admin, alice, bob] = await Promise.all(['admin', 'alice', 'bob'].map((l) => Client.login(l)));
  bobCursor = (await bob.bootstrap()).cursor;
  aliceCursor = (await alice.bootstrap()).cursor;
});

test('чужой Origin при небезопасном методе даёт 403 origin_mismatch', async () => {
  const r = await admin.ctx.post('/sync/push', {
    headers: { Origin: 'http://evil.example' },
    data: { clientId: admin.clientId, mutations: [] },
  });
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('origin_mismatch');
});

test('неверный пароль — 401 invalid_credentials', async () => {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const r = await ctx.post('/api/auth/login', { data: { login: 'admin', password: 'nope-nope' } });
  expect(r.status()).toBe(401);
  expect((await r.json()).code).toBe('invalid_credentials');
});

test('admin создаёт приватное пространство, проект и задачу', async () => {
  statusIds = Array.from({ length: 5 }, () => uuidv7());
  const [r1, r2, r3] = ranks(3);
  await admin.pushOk([
    admin.mut('space.create', {
      id: spaceId,
      name: `e2e ${spaceId}`,
      rank: r1,
      memberId: uuidv7(),
      statusIds,
    }),
    // the label is needed by the seed --tasks: it spreads tasks across all projects, including those left over from e2e
    admin.mut('label.create', { id: uuidv7(), spaceId, name: 'e2e', color: '#3b82f6' }),
    admin.mut('project.create', { id: projectId, spaceId, name: 'E2E', key: key(), rank: r2 }),
    admin.mut('task.create', {
      id: taskId,
      projectId,
      statusId: statusIds[0],
      title: 'секрет',
      rank: r3,
    }),
  ]);
  const boot = await admin.bootstrap();
  expect(ids(boot.data, 'spaces')).toContain(spaceId);
  expect(boot.data.tasks!.find((t) => t.id === taskId)?.number).toBe(1);
  expect(boot.lastMutationId).toBe(admin.mid);
});

test('файл загружается и прикладывается к задаче', async () => {
  const r = await admin.ctx.post('/files', {
    multipart: {
      file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from(`e2e ${spaceId}`) },
    },
  });
  expect(r.status()).toBe(201);
  const f = await r.json();
  sha = f.sha256;
  await admin.pushOk([
    admin.mut('attachment.create', {
      id: uuidv7(),
      taskId,
      fileSha256: sha,
      name: 'a.txt',
      mime: 'text/plain',
      size: f.size,
    }),
  ]);
  expect(ids((await admin.bootstrap()).data, 'attachments').length).toBeGreaterThan(0);
  expect((await admin.ctx.get(`/files/${sha}`)).status()).toBe(200);
});

test('bob не видит пространство в bootstrap', async () => {
  const { data } = await bob.bootstrap();
  expect(ids(data, 'spaces')).not.toContain(spaceId);
  expect(ids(data, 'tasks')).not.toContain(taskId);
  expect(data.attachments!.some((a) => a.taskId === taskId)).toBe(false);
});

test('bob не видит пространство в pull', async () => {
  const p = await bob.pull(bobCursor);
  expect(p.reset).toBeFalsy();
  expect(JSON.stringify(p.changes)).not.toContain(spaceId);
  expect(p.cursor).toBeGreaterThan(bobCursor); // cursor — across the whole journal
});

test('bob по WS получает только poke без данных', async () => {
  const ws = await bob.ws(bobCursor);
  const m = await ws.next();
  ws.close();
  expect(Object.keys(m).sort()).toEqual(['seq', 't']);
  expect(m.t).toBe('poke');
});

test('WS без сессии закрывается кодом 4401', async () => {
  const ws = await Ws.open(undefined, 0).catch(() => null);
  if (!ws) return; // a refusal on upgrade also closes access
  const code = await new Promise((res) => ws.sock.once('close', res));
  expect(code).toBe(4401);
});

test('файл чужого пространства для bob — 404', async () => {
  expect((await bob.ctx.get(`/files/${sha}`)).status()).toBe(404);
});

test('после member.add alice получает reset и видит строки', async () => {
  await admin.pushOk([
    admin.mut('member.add', { id: uuidv7(), spaceId, userId: alice.userId, role: 'member' }),
  ]);
  const p = await alice.pull(aliceCursor);
  expect(p.reset).toBe(true);
  const { data } = await alice.bootstrap();
  expect(ids(data, 'spaces')).toContain(spaceId);
  expect(ids(data, 'tasks')).toContain(taskId);
  expect((await alice.ctx.get(`/files/${sha}`)).status()).toBe(200);
});

test('офлайн-очередь: 30 задач с повтором пачек применены ровно один раз', async () => {
  const c = await Client.login('admin'); // new clientId, counter from 1
  const pid = uuidv7();
  const rk = ranks(32);
  const queue = [
    c.mut('project.create', { id: pid, spaceId, name: 'Queue', key: key(), rank: rk[0] }),
    ...Array.from({ length: 30 }, (_, i) =>
      c.mut('task.create', {
        id: uuidv7(),
        projectId: pid,
        statusId: statusIds[1],
        title: `q${i}`,
        rank: rk[i + 1],
      }),
    ),
  ];
  for (let i = 0; i < queue.length; i += 10) {
    const batch = queue.slice(i, i + 10);
    const first = await c.push(batch);
    const again = await c.push(batch); // disconnect after sending: the client does not know whether the batch arrived
    expect(first.every((r) => r.ok) && again.every((r) => r.ok)).toBe(true);
  }
  const boot = await c.bootstrap();
  const nums = boot.data.tasks!.filter((t) => t.projectId === pid).map((t) => t.number as number);
  expect(nums.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  expect(boot.lastMutationId).toBe(queue.at(-1)!.id);
  expect((await c.pull(boot.cursor)).lastMutationId).toBe(queue.at(-1)!.id);
});

test('отклонённая мутация даёт ok:false и не блокирует очередь; чужой clientId — 403', async () => {
  const c = await Client.login('admin');
  const [bad, good] = await c.push([
    c.mut('task.update', { id: 'не-uuid' }),
    c.mut('task.update', { id: taskId, title: 'после ошибки' }),
  ]);
  expect(bad).toMatchObject({ ok: false, code: 'invalid_args' });
  expect(good!.ok).toBe(true);
  const r = await alice.ctx.post('/sync/push', {
    data: {
      clientId: c.clientId,
      mutations: [{ id: 1, name: 'task.update', args: { id: taskId } }],
    },
  });
  expect(r.status()).toBe(403);
});

test('реалтайм: push одного клиента будит второго, pull отдаёт изменение', async () => {
  const a = await Client.login('admin');
  const b = await Client.login('admin');
  const { cursor } = await b.bootstrap();
  const ws = await b.ws(cursor);
  const poke = ws.next();
  await a.pushOk([a.mut('task.update', { id: taskId, title: 'realtime' })]);
  const m = await poke;
  ws.close();
  expect(m.t).toBe('poke');
  expect(m.seq as number).toBeGreaterThan(cursor);
  const p = await b.pull(cursor);
  expect(p.changes.some((c) => c.entity === 'tasks' && c.id === taskId)).toBe(true);
});

test('логаут: pull даёт 401', async () => {
  const c = await Client.login('bob');
  expect((await c.ctx.post('/api/auth/logout')).status()).toBe(204);
  const r = await c.ctx.get(`/sync/pull?cursor=0&clientId=${c.clientId}`);
  expect(r.status()).toBe(401);
});
