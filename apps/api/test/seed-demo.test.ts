import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { actionSchema, filterSchema, triggerSchema } from '@planar/module-automations/shared';
import { formFields } from '@planar/module-forms/shared';
import { projectTemplateSchema, taskTemplateSchema } from '@planar/module-templates/shared';
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
      (select count(*)::int from spaces
         where id::text <> (select value#>>'{}' from settings where id = 'root_space')) as spaces,
      (select count(*)::int from spaces
         where id::text = (select value#>>'{}' from settings where id = 'root_space')) as root,
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
    expect(c!.root).toBe(1); // Workspace level: without it group tabs have no scope
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
      'favorites',
      'field_defs',
      'saved_views',
      'day_plans',
      'task_watchers',
      'automations_rules',
      'templates_templates',
      'forms_forms',
      'forms_links',
      'workload_capacities',
    ])
      expect(
        (await q<{ n: number }>(`select count(*)::int as n from ${t}`))[0]!.n,
        t,
      ).toBeGreaterThan(0);
    // shared modules are off without settings.enabled_modules — chat data would be invisible (PLNRAPP-126)
    const [m] = await q<{ v: string[] }>(
      `select value as v from settings where id = 'enabled_modules'`,
    );
    expect(m?.v).toContain('chat');
  });

  it('JSON модулей проходит их схемы (иначе экраны демо пустые)', async () => {
    type J = Record<string, unknown>;
    for (const r of await q<J>(`select trigger, conditions, actions from automations_rules`)) {
      triggerSchema.parse(r.trigger);
      filterSchema.parse(r.conditions);
      for (const a of r.actions as unknown[]) actionSchema.parse(a);
    }
    for (const v of await q<J>(`select filter from saved_views`)) filterSchema.parse(v.filter);
    for (const t of await q<J>(`select kind, data from templates_templates`))
      (t.kind === 'task' ? taskTemplateSchema : projectTemplateSchema).parse(t.data);
    for (const f of await q<J>(`select fields from forms_forms`)) formFields.parse(f.fields);
  });

  it('--reset очищает всё кроме журнала миграций; тот же now — те же данные', async () => {
    const [{ n: migrations }] = (await q<{ n: number }>(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    )) as [{ n: number }];
    await resetDemo(db, NOW); // the journal `changes` holds the _reset row of migration 0032 until the first reset
    const first = await snapshot();
    await resetDemo(db, NOW);
    expect(await snapshot()).toEqual(first);
    const [after] = await q<{ n: number }>(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(after!.n).toBe(migrations);
  });
});
