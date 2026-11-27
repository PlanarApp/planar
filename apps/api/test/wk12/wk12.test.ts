import { Module } from '@nestjs/common';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { webhooksDeliveries as D } from '@planar/module-webhooks/api/schema';
import { CoreService } from '../../src/core.service.js';
import { settings } from '../../src/db/schema.js';
import { JobsService } from '../../src/jobs/jobs.js';
import { installed } from '../../src/modules/installed.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db as appDb, getApp, useApp } from '../auth/harness.js';
import { dbUrl, newDb } from '../sync/helpers.js';

@Module({})
class Fixture {}
const calls: unknown[] = [];
installed.push({
  api: {
    id: 'wk12t',
    nestModule: Fixture,
    mutators: [],
    entities: {},
    jobs: [
      {
        queue: 'wk12t.job',
        handler: async (data: unknown) => void calls.push(data),
      },
      {
        // PLNRAPP-884: a task's job; fail — the handler throws
        queue: 'wk12t.task',
        retryLimit: 0,
        handler: async (data: { fail?: boolean }) => {
          if (data.fail) throw new Error('wk12t: сбой');
        },
      },
    ],
  },
  tables: {},
});

useApp();
const db = newDb();
const jobs = new JobsService(db, { boss: true, databaseUrl: dbUrl });
afterAll(async () => {
  await jobs.onApplicationShutdown();
  await db.$client.end();
});

describe('wk12: CoreServices.enqueue', () => {
  it('wk12: вне транзакции ставит задачу, она выполняется при boss:true', async () => {
    await db
      .insert(settings)
      .values({ id: 'enabled_modules', value: ['wk12t'] })
      .onConflictDoUpdate({ target: settings.id, set: { value: ['wk12t'] } });
    await new CoreService(db, jobs).enqueue('wk12t.job', { n: 1 });
    await vi.waitFor(() => expect(calls).toEqual([{ n: 1 }]), { timeout: 20_000 });
  }, 40_000);

  it('wk12: boss:false — no-op', async () => {
    const off = new JobsService(db, { boss: false, databaseUrl: dbUrl });
    await expect(new CoreService(db, off).enqueue('wk12t.job', { n: 2 })).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('wk12: ping webhooks ставит webhooks.deliver сразу, без sweep', async () => {
    await appDb
      .insert(settings)
      .values({ id: 'enabled_modules', value: ['webhooks'] })
      .onConflictDoUpdate({ target: settings.id, set: { value: ['webhooks'] } });
    const cookie = await loginCookie(appDb, (await createUser(appDb, { role: 'admin' })).id);
    const spy = vi.spyOn(getApp().get(CoreService), 'enqueue');
    const inject = (url: string) =>
      getApp()
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'POST',
          url: `/api/webhooks/${url}`,
          payload:
            url === 'subscriptions' ? { url: 'http://example.com/h', events: ['ping'] } : undefined,
          headers: { cookie, origin: ORIGIN },
        });
    const sub = (await inject('subscriptions')).json().data;
    const p = (await inject(`subscriptions/${sub.id}/ping`)).json().data;
    expect(spy).toHaveBeenCalledWith('webhooks.deliver', { deliveryId: p.id });
    expect((await appDb.select().from(D).where(eq(D.id, p.id)))[0]).toBeTruthy();
  });
});

// PLNRAPP-884: a task's job without an ai_runs row (a rule's) — the clients see it in the queue: signals on enqueue
// and after the settle (the job is no longer active by then), no polling
describe('PLNRAPP-884: сигнал planar_work от заданий задачи', () => {
  it('постановка, выполнение и сбой задания задачи — сигнал; задание без taskId — нет', async () => {
    await db
      .insert(settings)
      .values({ id: 'enabled_modules', value: ['wk12t'] })
      .onConflictDoUpdate({ target: settings.id, set: { value: ['wk12t'] } });
    const taskId = crypto.randomUUID();
    const got: { id: string }[] = [];
    const l = new pg.Client({ connectionString: dbUrl });
    await l.connect();
    l.on('notification', (m) => {
      const p = JSON.parse(m.payload ?? '{}') as { id: string };
      got.push({ id: p.id });
    });
    await l.query('LISTEN planar_work');
    const stateOf = async (id: string) =>
      (
        await db.execute(
          sql`select state::text as s from pgboss.job where name = 'wk12t.task' and data->>'taskId' = ${id}`,
        )
      ).rows.map((r) => r.s as string);
    try {
      await jobs.enqueue('wk12t.job', { n: 3 });
      await jobs.enqueue('wk12t.task', { taskId });
      // enqueue + settle: two signals of the task; the job is completed before the second one
      await vi.waitFor(() => expect(got.filter((g) => g.id === taskId)).toHaveLength(2), {
        timeout: 20_000,
      });
      expect(await stateOf(taskId)).toEqual(['completed']);
      const failed = crypto.randomUUID();
      await jobs.enqueue('wk12t.task', { taskId: failed, fail: true });
      await vi.waitFor(() => expect(got.filter((g) => g.id === failed)).toHaveLength(2), {
        timeout: 20_000,
      });
      expect(await stateOf(failed)).toEqual(['failed']);
      expect(got.every((g) => g.id === taskId || g.id === failed)).toBe(true);
    } finally {
      await l.end();
    }
  }, 60_000);
});
