import { count } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { seed } from '../src/db/seed.js';
import * as s from '../src/db/schema.js';
import { testDb } from './db.js';

const db = testDb();
afterAll(() => db.$client.end());

describe('seed', () => {
  it('идемпотентен; --tasks добавляет задачи и двигает task_counter', async () => {
    await seed(db, 30);
    await seed(db, 20);
    const [u] = await db.select({ n: count() }).from(s.users);
    const [t] = await db.select({ n: count() }).from(s.tasks);
    const nums = await db.$client
      .query<{ ok: boolean }>(
        `select bool_and(t.number between 1 and p.task_counter) as ok
         from tasks t join projects p on p.id = t.project_id`,
      )
      .then((r) => r.rows[0]);
    expect([u!.n, t!.n, nums!.ok]).toEqual([3, 50, true]);
  });
});
