import { Module } from '@nestjs/common';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
