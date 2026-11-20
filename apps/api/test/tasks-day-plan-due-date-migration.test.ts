// PLNRAPP-708: migration 0078 on data — the «My day» plan date (day_plans.date) -> tasks.due_date where it is empty
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, migrate } from '../src/db/index.js';

const drizzleDir = new URL('../drizzle', import.meta.url).pathname;
const sqlFile = join(drizzleDir, '0078_day_plan_due_date.sql');
const name = `planar_t_mig78_${randomBytes(5).toString('hex')}`;
const adminUrl = inject('dbAdminUrl');
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let admin: pg.Client;
let db: ReturnType<typeof createDb>;
let tmp: string;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await db.$client.query(text, params)).rows as T[];
const id = async (text: string, params: unknown[] = []) =>
  (await q<{ id: string }>(text, params))[0]!.id;

type Due = Record<string, string | null>;
const dues = async (): Promise<Due> =>
  Object.fromEntries(
    (
      await q<{ title: string; due: string | null }>(
        `select title, due_date::text as due from tasks`,
      )
    ).map((r) => [r.title, r.due]),
  );
const resets = () =>
  q<{ id: string }>(`select id from changes where entity = '_reset' order by seq`);

// before the migration: A — plan, no due; B — plan = due; C — plan != due; D — no plan, no due;
// E — no plan, due; M — two users and a carried-over day (the latest date wins)
let before: Due;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  db = createDb(url.toString());

  tmp = mkdtempSync(join(tmpdir(), 'mig78-'));
  cpSync(drizzleDir, tmp, { recursive: true });
  const jp = join(tmp, 'meta/_journal.json');
  const j = JSON.parse(readFileSync(jp, 'utf8'));
  const all = j.entries;
  j.entries = all.filter((e: { idx: number }) => e.idx < 78);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);

  const user = (login: string) =>
    id(
      `insert into users (login, name, role, password_hash) values ($1, $1, 'owner', 'x') returning id`,
      [login],
    );
  const [u1, u2] = [await user('mig78a'), await user('mig78b')];
  const space = await id(
    `insert into spaces (name, rank, created_by) values ('S', 'a0', $1) returning id`,
    [u1],
  );
  const project = await id(
    `insert into projects (space_id, name, key, rank) values ($1, 'P', 'P', 'a0') returning id`,
    [space],
  );
  const status = await id(
    `insert into statuses (space_id, project_id, name, category, color, rank) values ($1, $2, 'x', 'todo', '#000', 'a') returning id`,
    [space, project],
  );
  const task = (title: string, due: string | null) =>
    id(
      `insert into tasks (space_id, project_id, status_id, title, priority, rank, created_by, due_date)
       values ($1, $2, $3, $4, 0, 'a0', $5, $6) returning id`,
      [space, project, status, title, u1, due],
    );
  const plan = (userId: string, taskId: string, date: string) =>
    q(`insert into day_plans (user_id, task_id, date, rank) values ($1, $2, $3, 'a0')`, [
      userId,
      taskId,
      date,
    ]);
  await plan(u1, await task('A', null), '2026-11-21');
  await plan(u1, await task('B', '2026-11-22'), '2026-11-22');
  await plan(u1, await task('C', '2026-12-01'), '2026-11-23');
  await task('D', null);
  await task('E', '2026-12-05');
  const m = await task('M', null);
  await plan(u1, m, '2026-11-18');
  await plan(u1, m, '2026-11-25');
  await plan(u2, m, '2026-11-24');

  before = await dues();
  await q(`delete from changes`); // so that the only row after the migration is the one it writes
  j.entries = all;
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp); // 0078
}, 120_000);

afterAll(async () => {
  await db?.$client.end();
  await admin?.query(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin?.end();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('PLNRAPP-708 миграция 0078: дата плана «Моего дня» -> dueDate', () => {
  it('задача с датой плана и пустым dueDate получает dueDate = дате плана; из нескольких — самую позднюю', async () => {
    const after = await dues();
    expect(after.A).toBe('2026-11-21');
    expect(after.M).toBe('2026-11-25');
  });

  it('задачи с заполненным dueDate и без плана не меняются', async () => {
    const after = await dues();
    for (const t of ['B', 'C', 'D', 'E']) expect(after[t], t).toBe(before[t]);
    expect(after.C).toBe('2026-12-01');
  });

  it('day_plans не удаляется; клиентам — одна строка _reset', async () => {
    expect((await q(`select 1 from day_plans`)).length).toBe(6);
    expect((await resets()).map((r) => r.id)).toEqual(['plnrapp-708-day-plan-due-date']);
  });

  it('повторный запуск ничего не меняет и не пишет _reset', async () => {
    const first = await dues();
    const updated = await q(`select id, updated_at from tasks order by id`);
    await db.$client.query(readFileSync(sqlFile, 'utf8'));
    expect(await dues()).toEqual(first);
    expect(await q(`select id, updated_at from tasks order by id`)).toEqual(updated);
    expect((await resets()).length).toBe(1);
  });
});
