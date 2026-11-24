// Tables that only grew (audit PLNRAPP-858): expired sessions, login counters, form rate limits and links, webhook history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { authPurge } from '../../src/jobs/auth.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { api as formsApi } from '../../../../modules/forms/api/index.js';
import { jobs as webhookJobs } from '../../../../modules/webhooks/api/deliver.js';
import { newDb, world, type World } from '../sync/helpers.js';

const db = newDb();
let w: World;
const job = { db } as unknown as JobApi;
const raw = (q: string, a: unknown[] = []) => db.$client.query(q, a).then((r) => r.rows);
const run = (list: unknown[] | undefined, queue: string) =>
  (list as { queue: string; handler(d: unknown, a: JobApi): Promise<void> }[])
    .find((j) => j.queue === queue)!
    .handler({}, job);

beforeAll(async () => {
  w = await world(db);
});
afterAll(() => db.$client.end());

describe('очистка растущих таблиц', () => {
  it('сессии: истёкшие удаляются, живые остаются; счётчики входа старше суток — тоже', async () => {
    const [dead, live] = [uuidv7(), uuidv7()];
    await raw(
      `insert into sessions (id, user_id, expires_at) values ($1, $3, now() - interval '1 minute'), ($2, $3, now() + interval '1 day')`,
      [dead, live, w.member.userId],
    );
    await raw(
      `insert into login_attempts (key, attempts, window_started_at) values ('old', 3, now() - interval '2 days'), ('new', 3, now())`,
    );
    await authPurge.handler({}, job);
    const ids = (await raw('select id from sessions where id = any($1)', [[dead, live]])).map(
      (r) => r.id,
    );
    expect(ids).toEqual([live]);
    const keys = (await raw(`select key from login_attempts where key in ('old', 'new')`)).map(
      (r) => r.key,
    );
    expect(keys).toEqual(['new']);
  });

  it('формы: окна лимита старше суток и давно истёкшие ссылки удаляются', async () => {
    await raw(
      `insert into forms_rate_limits (key, count, window_started_at) values ('f-old', 1, now() - interval '2 days'), ('f-new', 1, now())`,
    );
    const [old, fresh] = [uuidv7(), uuidv7()];
    await raw(
      `insert into forms_links (id, form_id, task_id, token_hash, expires_at, single_use, created_by, created_at)
       values ($1, $3, $3, $4, now() - interval '31 days', true, $6, now()), ($2, $3, $3, $5, now() + interval '1 day', true, $6, now())`,
      [old, fresh, uuidv7(), `h-${old}`, `h-${fresh}`, w.admin.userId],
    );
    await run(formsApi.jobs, 'forms.cleanup');
    expect(
      (await raw(`select key from forms_rate_limits where key like 'f-%'`)).map((r) => r.key),
    ).toEqual(['f-new']);
    expect(
      (await raw('select id from forms_links where id = any($1)', [[old, fresh]])).map((r) => r.id),
    ).toEqual([fresh]);
  });

  it('вебхуки: завершённые доставки старше 30 дней удаляются, pending остаются', async () => {
    const sub = uuidv7();
    await raw(
      `insert into webhooks_subscriptions (id, url, secret, events, active, created_by)
       values ($1, 'https://example.com', 's', '{}', true, $2)`,
      [sub, w.admin.userId],
    );
    const [done, pending, recent] = [uuidv7(), uuidv7(), uuidv7()];
    await raw(
      `insert into webhooks_deliveries (id, subscription_id, event, payload, status, created_at) values
        ($1, $4, 'e', '{}', 'ok', now() - interval '31 days'),
        ($2, $4, 'e', '{}', 'pending', now() - interval '31 days'),
        ($3, $4, 'e', '{}', 'failed', now())`,
      [done, pending, recent, sub],
    );
    await run(webhookJobs, 'webhooks.cleanup');
    const left = (await raw('select id from webhooks_deliveries where subscription_id = $1', [sub]))
      .map((r) => r.id)
      .sort();
    expect(left).toEqual([pending, recent].sort());
  });
});
