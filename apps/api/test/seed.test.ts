import { count } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { seed } from '../src/db/seed.js';
import * as s from '../src/db/schema.js';
import { testDb } from './db.js';

const db = testDb();
afterAll(() => db.$client.end());

describe('seed', () => {
  it('идемпотентен; --tasks N доводит число задач до N и двигает task_counter', async () => {
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
    expect([u!.n, t!.n, nums!.ok]).toEqual([3, 30, true]);
  });

  it('--tasks не падает, если в пространствах нет меток', async () => {
    await db.delete(s.taskLabels);
    await db.delete(s.labels);
    await seed(db, 40);
    const [after] = await db.select({ n: count() }).from(s.tasks);
    expect(after!.n).toBe(40);
  });

  it('повтор с тем же N и меньшим N задачи не добавляет', async () => {
    await seed(db, 40);
    await seed(db, 5);
    const [t] = await db.select({ n: count() }).from(s.tasks);
    expect(t!.n).toBe(40);
  });
});
