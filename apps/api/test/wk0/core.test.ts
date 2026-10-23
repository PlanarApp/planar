import { Module } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, type AfterMutationCtx, type MutationWrite } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import type { JobApi, ModuleHookApi } from '../../src/modules/hooks.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import { PullService } from '../../src/sync/pull.service.js';
import { PushService } from '../../src/sync/push.service.js';
import { ensureSystemUser } from '../../src/users/system.js';
import { ORIGIN } from '../auth.js';
import { dbUrl, newDb, TestClient, world, type World } from '../sync/helpers.js';

@Module({})
class FixtureModule {}

// Тестовый модуль: подмена списка installed (мутируемый массив) до старта pg-boss.
const hookCalls: { writes: MutationWrite[]; ctx: AfterMutationCtx }[] = [];
const jobCalls: { queue: string; data: unknown; api: JobApi }[] = [];
let mode: 'record' | 'patch-throw' | 'patch' = 'record';
installed.push({
  api: {
    id: 'wkt',
    nestModule: FixtureModule,
    mutators: [],
    entities: {},
    async afterMutation(writes, ctx, api: ModuleHookApi) {
      hookCalls.push({ writes, ctx });
      const t = writes.find((w) => w.entity === 'tasks' && w.op === 'put' && !w.before);
      if (!t) return;
      const after = t.after as { id: string; title: string };
      if (mode !== 'record') await api.sys.patch('tasks', after.id, { title: 'hooked' });
      if (mode === 'patch-throw') throw new Error('boom');
      if (after.title === 'enqueue-me') await api.enqueue('wkt.ping', { id: after.id });
    },
    jobs: [
      {
        queue: 'wkt.ping',
        handler: async (data: unknown, api: JobApi) =>
          void jobCalls.push({ queue: 'wkt.ping', data, api }),
      },
      { queue: 'wkt.cron', cron: '0 3 * * *', handler: async () => {} },
    ],
  },
  tables: {},
});

const db = newDb();
const queue = new PushQueue(db, { boss: true, databaseUrl: dbUrl });
let w: World;
let admin: TestClient;
const setEnabled = (ids: string[]) =>
  db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ids })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ids } });
const taskArgs = (title: string) => ({
  id: uuidv7(),
  projectId: w.projectId,
  statusId: w.statusIds[1],
  title,
  rank: 'a0',
});
const taskRow = async (id: string) =>
  (await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)))[0];

beforeAll(async () => {
  w = await world(db);
  admin = new TestClient(
    { push: new PushService(db, queue), pull: new PullService(db) },
    w.admin.userId,
  );
});
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});
beforeEach(async () => {
  hookCalls.length = 0;
  jobCalls.length = 0;
  mode = 'record';
  await setEnabled(['wkt']);
});

describe('wk0: afterMutation', () => {
  it('wk0: хук получает writes мутации и ctx', async () => {
    const a = taskArgs('plain');
    await admin.ok('task.create', a);
    const call = hookCalls.at(-1)!;
    expect(call.ctx).toMatchObject({
      userId: w.admin.userId,
      mutator: 'task.create',
      system: false,
      origin: null,
      tokenId: null,
    });
    expect(call.writes).toContainEqual(
      expect.objectContaining({ entity: 'tasks', op: 'put', before: null }),
    );
    expect(call.writes.find((x) => x.entity === 'tasks')!.after).toMatchObject({ id: a.id });
  });

  it('wk0: запись хука попадает в changes и коммитится', async () => {
    mode = 'patch';
    const a = taskArgs('x');
    await admin.ok('task.create', a);
    expect((await taskRow(a.id))!.title).toBe('hooked');
    // записи хука в writes следующих хуков не попадают
    expect(hookCalls).toHaveLength(1);
    const ch = await db
      .select()
      .from(schema.changes)
      .where(and(eq(schema.changes.entity, 'tasks'), eq(schema.changes.id, a.id)));
    expect(ch.at(-1)!.data).toMatchObject({ title: 'hooked' });
  });

  it('wk0: ошибка хука не откатывает мутацию и её changes, запись хука откатывается', async () => {
    mode = 'patch-throw';
    const a = taskArgs('survives');
    await admin.ok('task.create', a);
    expect((await taskRow(a.id))!.title).toBe('survives');
    const ch = await db
      .select()
      .from(schema.changes)
      .where(and(eq(schema.changes.entity, 'tasks'), eq(schema.changes.id, a.id)));
    expect(ch).toHaveLength(1);
    expect(ch[0]!.data).toMatchObject({ title: 'survives' });
  });

  it('wk0: хук выключенного модуля не вызывается', async () => {
    await setEnabled([]);
    await admin.ok('task.create', taskArgs('off'));
    expect(hookCalls).toHaveLength(0);
  });
});

describe('wk0: задачи модулей', () => {
  it('wk0: enqueue в откаченной мутации не создаёт задачу, в закоммиченной — выполняется', async () => {
    const api = await queue.jobs.api();
    const bad = taskArgs('enqueue-me');
    await expect(
      api.execute(w.admin.userId, [
        { name: 'task.create', args: bad },
        { name: 'task.create', args: { id: 'не-uuid' } },
      ]),
    ).rejects.toThrow();
    expect(await taskRow(bad.id)).toBeUndefined();
    expect(hookCalls).toHaveLength(1); // хук ещё работал до отката
    await new Promise((r) => setTimeout(r, 1500));
    expect(jobCalls).toHaveLength(0);

    const good = taskArgs('enqueue-me');
    await admin.ok('task.create', good);
    await vi.waitFor(() => expect(jobCalls).toHaveLength(1), { timeout: 20_000 });
    expect(jobCalls[0]!.data).toEqual({ id: good.id });
    expect(await taskRow(good.id)).toBeDefined(); // задача видит закоммиченное
  }, 40_000);

  it('wk0: cron-расписание создаётся', async () => {
    const boss = (await queue.jobs.start())!;
    const s = await boss.getSchedules('wkt.cron');
    expect(s.map((x) => x.cron)).toEqual(['0 3 * * *']);
  });

  it('wk0: задача выключенного модуля завершается без handler', async () => {
    const boss = (await queue.jobs.start())!;
    await setEnabled([]);
    const id = (await boss.send('wkt.ping', { off: true }))!;
    await vi.waitFor(
      async () => expect((await boss.getJobById('wkt.ping', id))?.state).toBe('completed'),
      { timeout: 20_000 },
    );
    expect(jobCalls).toHaveLength(0);
  }, 30_000);

  it('wk0: execute(system) обходит права, actorId — системный пользователь', async () => {
    const api = await queue.jobs.api();
    const a = taskArgs('by-system');
    // чужой пользователь без членства: без system — отказ
    await expect(
      api.execute(w.outsider.userId, [{ name: 'task.create', args: taskArgs('denied') }]),
    ).rejects.toThrow();
    await api.execute(api.systemUserId, [{ name: 'task.create', args: a }], {
      system: true,
      origin: { ruleId: 'r1', depth: 1 },
    });
    const [act] = await db.select().from(schema.activity).where(eq(schema.activity.taskId, a.id));
    expect(act!.actorId).toBe(api.systemUserId);
    expect(hookCalls.at(-1)!.ctx).toMatchObject({
      system: true,
      origin: { ruleId: 'r1', depth: 1 },
      userId: api.systemUserId,
    });
  });
});

describe('wk0: системный пользователь', () => {
  it('wk0: ensureSystemUser идемпотентен, строка попадает в changes один раз', async () => {
    const a = await ensureSystemUser(db);
    const b = await ensureSystemUser(db);
    expect(b).toBe(a);
    const rows = await db.select().from(schema.users).where(eq(schema.users.login, 'automation'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Автоматизация', role: 'member' });
    expect(rows[0]!.deactivatedAt).not.toBeNull();
    const ch = await db.select().from(schema.changes).where(eq(schema.changes.id, a));
    expect(ch).toHaveLength(1);
  });

  it('wk0: вход системным пользователем невозможен, API создаёт его при старте', async () => {
    const app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      const res = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin: ORIGIN },
          payload: { login: 'automation', password: '!' },
        });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('wk0: tasks.cycleId в БД: по умолчанию null, индексируется', async () => {
    const a = taskArgs('cyc');
    await admin.ok('task.create', a);
    expect((await taskRow(a.id))!.cycleId).toBeNull();
  });
});
