import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { resetDemo, seedDemo } from '../src/db/seed-demo.js';
import { testDb } from './db.js';

const db = testDb();
afterAll(() => db.$client.end());

const NOW = new Date('2026-03-10T12:00:00Z');
const q = <T>(text: string) => db.$client.query(text).then((r) => r.rows as T[]);

/** Hash of every application table (rows in a stable order). */
async function snapshot() {
  const tables = await q<{ t: string }>(
    `select tablename as t from pg_tables where schemaname = 'public' order by 1`,
  );
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const rows = await q<{ r: string }>(`select r::text from "${t}" r order by 1`);
    out[t] = createHash('sha256')
      .update(rows.map((x) => x.r).join('\n'))
      .digest('hex');
  }
  return out;
}

describe('seed-demo', () => {
  it('без флага на непустой базе — ошибка; пустая заполняется', async () => {
    await seedDemo(db, NOW);
    await expect(seedDemo(db, NOW)).rejects.toThrow('demo seed: database is not empty');
  });

  it('состав: пользователи, пространства, задачи, спринты, модули', async () => {
    const [c] = await q<Record<string, number>>(`select
      (select count(*)::int from users where login <> 'automation') as users,
      (select count(*)::int from users where login = 'demo' and password_hash = '!') as demo,
      (select count(*)::int from spaces) as spaces,
      (select count(*)::int from tasks where due_date > '${NOW.toISOString().slice(0, 10)}') as future,
      (select count(*)::int from tasks t join statuses s on s.id = t.status_id
         where t.due_date < '${NOW.toISOString().slice(0, 10)}' and s.category in ('todo','in_progress')) as overdue,
      (select count(*)::int from sprints_cycles where closed_at is not null) as closed,
      (select count(*)::int from sprints_cycles where closed_at is null
         and start_date <= '${NOW.toISOString().slice(0, 10)}' and end_date >= '${NOW.toISOString().slice(0, 10)}') as active`);
    expect(c!.users).toBeGreaterThanOrEqual(8);
    expect(c!.users).toBeLessThanOrEqual(12);
    expect(c!.demo).toBe(1);
    expect(c!.spaces).toBeGreaterThanOrEqual(4);
    expect(c!.spaces).toBeLessThanOrEqual(5);
    expect(c!.future).toBeGreaterThan(0);
    expect(c!.overdue).toBeGreaterThan(0);
    expect([c!.closed, c!.active]).toEqual([1, 1]);
    for (const t of [
      'goals_goals',
      'time_entries',
      'dashboards_widgets',
      'docs_pages',
      'chat_messages',
      'recurring_rules',
      'comments',
      'checklist_items',
    ])
      expect(
        (await q<{ n: number }>(`select count(*)::int as n from ${t}`))[0]!.n,
        t,
      ).toBeGreaterThan(0);
  });

  it('--reset очищает всё кроме журнала миграций; тот же now — те же данные', async () => {
    const [{ n: migrations }] = (await q<{ n: number }>(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    )) as [{ n: number }];
    const first = await snapshot();
    await resetDemo(db, NOW);
    expect(await snapshot()).toEqual(first);
    const [after] = await q<{ n: number }>(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(after!.n).toBe(migrations);
  });
});
