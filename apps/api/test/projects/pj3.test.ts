// PJ-3: data modules per project — project.setModule, gating of mutators / jobs, `unavailable`
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_MODULE_IDS, uuidv7, WORKSPACE_DATA_MODULE_IDS } from '@planar/shared';
import { todayIn } from '@planar/module-sprints/shared';
import * as schema from '../../src/db/schema.js';
import { enabledModules } from '../../src/modules/enabled.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import {
  TestClient,
  dbUrl,
  key,
  mkUser,
  newDb,
  services,
  taskArgs,
  world,
} from '../sync/helpers.js';
import type { World } from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;
let instanceAdmin: TestClient;

beforeAll(async () => {
  w = await world(db);
  instanceAdmin = new TestClient(services(db), await mkUser(db, 'admin'));
});
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const modulesOf = async (projectId: string) =>
  (await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)))[0]!.modules;
/** A project without data modules (TestClient turns them all on for projects it creates). */
async function bareProject() {
  const id = uuidv7();
  await w.admin.ok('project.create', { id, spaceId: w.spaceId, name: 'B', key: key(), rank: 'a0' });
  await db.update(schema.projects).set({ modules: [] }).where(eq(schema.projects.id, id));
  return id;
}

describe('PJ-3: project.setModule — права', () => {
  it('PJ-3 админ пространства и админ экземпляра меняют модули, участник/гость/посторонний — forbidden', async () => {
    const p = await bareProject();
    const set = (c: TestClient, moduleId: string, enabled = true) =>
      c.push('project.setModule', { projectId: p, moduleId, enabled });
    for (const c of [w.member, w.guest, w.outsider])
      expect(await set(c, 'time'), c.userId).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await modulesOf(p)).toEqual([]);
    expect(await set(w.admin, 'time')).toMatchObject({ ok: true });
    expect(await set(instanceAdmin, 'docs')).toMatchObject({ ok: true }); // not a member of the space
    expect(await modulesOf(p)).toEqual(['time', 'docs']);
    expect(await set(w.admin, 'time')).toMatchObject({ ok: true }); // idempotent
    expect(await set(w.admin, 'time', false)).toMatchObject({ ok: true });
    expect(await modulesOf(p)).toEqual(['docs']);
  });

  it('PJ-3 общий модуль и неизвестный id → invalid_args; project.update не меняет модули', async () => {
    const p = await bareProject();
    for (const moduleId of ['chat', 'email', 'nope'])
      expect(
        await w.admin.push('project.setModule', { projectId: p, moduleId, enabled: true }),
      ).toMatchObject({ ok: false, code: 'invalid_args' });
    await w.admin.ok('project.update', { id: p, name: 'Renamed', modules: ['time'] });
    expect(await modulesOf(p)).toEqual([]);
  });

  it('PJ-3 settings.set enabled_modules: id модуля данных → invalid_args; общие — ok; data-модули всегда установлены', async () => {
    expect(
      await instanceAdmin.push('settings.set', { id: 'enabled_modules', value: ['chat', 'time'] }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    await instanceAdmin.ok('settings.set', { id: 'enabled_modules', value: ['chat'] });
    const on = await enabledModules(db);
    expect(on.has('chat')).toBe(true);
    expect(on.has('email')).toBe(false);
    for (const id of DATA_MODULE_IDS)
      expect(on.has(id), id).toBe(!WORKSPACE_DATA_MODULE_IDS.includes(id));
    await instanceAdmin.ok('settings.set', { id: 'enabled_modules', value: [] });
  });

  it('PLNRAPP-241: ai — переключатель воркспейса; включить можно только при PLANAR_AI=on', async () => {
    delete process.env.PLANAR_AI;
    try {
      expect(
        await instanceAdmin.push('settings.set', { id: 'enabled_modules', value: ['ai'] }),
      ).toMatchObject({ ok: false, code: 'invalid_args', message: 'ai_env_off' });
    } finally {
      process.env.PLANAR_AI = 'on';
    }
    expect((await enabledModules(db)).has('ai')).toBe(false);
    await instanceAdmin.ok('settings.set', { id: 'enabled_modules', value: ['ai'] });
    expect((await enabledModules(db)).has('ai')).toBe(true);
    await instanceAdmin.ok('settings.set', { id: 'enabled_modules', value: [] });
  });
});

describe('PJ-3: мутаторы модуля в проекте, где он выключен', () => {
  it('PJ-3 time.start: проект без модуля → conflict module_disabled, с модулем — ok; данные при выключении не теряются', async () => {
    const p = await bareProject();
    const a = taskArgs(w, { projectId: p });
    await w.admin.ok('task.create', {
      ...a,
      statusId: (
        await db.select().from(schema.statuses).where(eq(schema.statuses.projectId, p))
      )[1]!.id,
    });
    const start = (c: TestClient, id = uuidv7()) => c.push('time.start', { id, taskId: a.id });
    expect(await start(w.admin)).toMatchObject({
      ok: false,
      code: 'conflict',
      message: expect.stringContaining('module_disabled'),
    });
    await w.admin.ok('project.setModule', { projectId: p, moduleId: 'time', enabled: true });
    const id = uuidv7();
    expect(await start(w.admin, id)).toMatchObject({ ok: true });
    await w.admin.ok('project.setModule', { projectId: p, moduleId: 'time', enabled: false });
    const rows = await db.$client.query(`select id from time_entries where id = $1`, [id]);
    expect(rows.rows).toHaveLength(1); // data stays
    await w.admin.ok('project.setModule', { projectId: p, moduleId: 'time', enabled: true });
    expect(
      (await db.$client.query(`select id from time_entries where id = $1`, [id])).rows,
    ).toHaveLength(1);
  });

  it('PJ-3 sprints.configure по projectId: выключен в одном проекте, работает в другом', async () => {
    const off = await bareProject();
    expect(await w.admin.push('sprints.configure', { projectId: off })).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    expect(await w.admin.push('sprints.configure', { projectId: w.projectId })).toMatchObject({
      ok: true,
    });
  });
});

describe('PJ-3: задания опроса', () => {
  const job = (queueName: string) =>
    (
      installed.find((m) => m.api.id === 'sprints')!.api.jobs as {
        queue: string;
        handler(d: unknown, api: JobApi): Promise<void>;
      }[]
    ).find((j) => j.queue === queueName)!;

  it('PJ-3 sprints.close-due пропускает проект, где модуль выключен', async () => {
    const enqueued: string[] = [];
    const api: JobApi = {
      ...(await queue.jobs.api()),
      enqueue: async (_q, _d, o) => void enqueued.push(o?.singletonKey as string),
    };
    const p = await bareProject();
    await w.admin.ok('project.setModule', { projectId: p, moduleId: 'sprints', enabled: true });
    await w.admin.ok('sprints.configure', { projectId: p, timezone: 'Pacific/Kiritimati' });
    const cycleId = uuidv7();
    const d = todayIn('Pacific/Pago_Pago');
    await w.admin.ok('sprints.create', { id: cycleId, projectId: p, startDate: d, endDate: d });
    await job('sprints.close-due').handler({}, api);
    expect(enqueued).toContain(cycleId);
    enqueued.length = 0;
    await w.admin.ok('project.setModule', { projectId: p, moduleId: 'sprints', enabled: false });
    await job('sprints.close-due').handler({}, api);
    expect(enqueued).not.toContain(cycleId);
    // closing a cycle of a project with the module off does nothing
    await job('sprints.close-cycle').handler({ cycleId }, api);
    expect(
      (await db.$client.query(`select closed_at from sprints_cycles where id = $1`, [cycleId]))
        .rows[0].closed_at,
    ).toBeNull();
  });
});
