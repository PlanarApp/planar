// PJ-1: migration 0032 on data — statuses and labels of a space are copied into every project of the space
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, migrate } from '../../src/db/index.js';

const drizzleDir = new URL('../../drizzle', import.meta.url).pathname;
const name = `planar_t_mig_${randomBytes(5).toString('hex')}`;
const adminUrl = inject('dbAdminUrl');
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let admin: pg.Client;
let db: ReturnType<typeof createDb>;
let tmp: string;

const q = async <T = Record<string, string>>(text: string, params: unknown[] = []) =>
  (await db.$client.query(text, params)).rows as T[];
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0]!;
const id = async (text: string, params: unknown[] = []) => (await one(text, params)).id as string;

const ids: Record<string, string> = {};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  db = createDb(url.toString());

  // the schema before 0032: the migrations folder cut at idx 31
  tmp = mkdtempSync(join(tmpdir(), 'pj1-'));
  cpSync(drizzleDir, tmp, { recursive: true });
  const jp = join(tmp, 'meta/_journal.json');
  const j = JSON.parse(readFileSync(jp, 'utf8'));
  j.entries = j.entries.filter((e: { idx: number }) => e.idx < 32);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);

  const user = await id(
    `insert into users (login, name, role, password_hash) values ('mig', 'Mig', 'owner', 'x') returning id`,
  );
  const space = async (n: string) =>
    id(`insert into spaces (name, rank, created_by) values ($1, 'a0', $2) returning id`, [n, user]);
  const project = async (s: string, key: string) =>
    id(`insert into projects (space_id, name, key, rank) values ($1, $2, $2, 'a0') returning id`, [
      s,
      key,
    ]);
  const status = async (s: string, n: string, category: string, rank: string) =>
    id(
      `insert into statuses (space_id, name, category, color, rank) values ($1, $2, $3, '#000', $4) returning id`,
      [s, n, category, rank],
    );
  const label = async (s: string, n: string) =>
    id(`insert into labels (space_id, name, color) values ($1, $2, '#f00') returning id`, [s, n]);

  // 3 spaces: S1 (2 projects), S2 (1 project), S3 (no projects)
  const [s1, s2, s3] = [await space('S1'), await space('S2'), await space('S3')];
  const [p1, p2, p3] = [
    await project(s1, 'PONE'),
    await project(s1, 'PTWO'),
    await project(s2, 'PTHREE'),
  ];
  Object.assign(ids, { s1, s2, s3, p1, p2, p3 });
  ids.todo1 = await status(s1, 'Todo', 'todo', 'a1');
  ids.done1 = await status(s1, 'Done', 'done', 'a3');
  ids.todo2 = await status(s2, 'Todo', 'todo', 'a1');
  ids.s3st = await status(s3, 'Lonely', 'todo', 'a1');
  ids.bug1 = await label(s1, 'Bug');
  ids.feat1 = await label(s1, 'Feat');
  ids.bug2 = await label(s2, 'Bug');
  ids.s3lb = await label(s3, 'Lonely');

  const task = async (s: string, p: string, st: string, n: number) =>
    id(
      `insert into tasks (space_id, project_id, number, status_id, title, priority, rank, created_by)
       values ($1, $2, $3, $4, $5, 0, 'a0', $6) returning id`,
      [s, p, n, st, `t${n}`, user],
    );
  ids.t1 = await task(s1, p1, ids.todo1!, 1);
  ids.t2 = await task(s1, p2, ids.done1!, 1);
  ids.t3 = await task(s2, p3, ids.todo2!, 1);
  const tl = (s: string, t: string, l: string) =>
    q(`insert into task_labels (space_id, task_id, label_id) values ($1, $2, $3)`, [s, t, l]);
  await tl(s1, ids.t1!, ids.bug1!);
  await tl(s1, ids.t1!, ids.feat1!);
  await tl(s1, ids.t2!, ids.bug1!);
  await tl(s2, ids.t3!, ids.bug2!);

  // module references and stored ids
  await q(
    `insert into gitlab_project_settings (id, space_id, merged_status_id, updated_at) values ($1, $2, $3, now())`,
    [p1, s1, ids.done1],
  );
  ids.form = await id(
    `insert into forms_forms (id, space_id, project_id, slug, title, fields, status_id, enabled, created_by, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, 'pj1-form', 'F', '[]', $3, true, $4, now(), now()) returning id`,
    [s1, p2, ids.todo1, user],
  );
  ids.rule = await id(
    `insert into automations_rules (id, space_id, project_id, name, enabled, trigger, conditions, actions, created_by, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, 'R', true, $3::jsonb, $4::jsonb, $5::jsonb, $6, now(), now()) returning id`,
    [
      s1,
      p1,
      JSON.stringify({ type: 'task.status_changed', from: [ids.todo1], to: [ids.done1] }),
      JSON.stringify({ op: 'and', rules: [{ field: 'label', operator: 'in', value: [ids.bug1] }] }),
      JSON.stringify([
        { type: 'set_status', statusId: ids.done1 },
        { type: 'add_label', labelId: ids.feat1 },
        { type: 'move_to_project', projectId: p2, statusId: ids.todo1 },
      ]),
      user,
    ],
  );
  ids.view = await id(
    `insert into saved_views (space_id, created_by, name, layout, filter, config, rank)
     values ($1, $2, 'V', 'list', $3::jsonb, '{}', 'a0') returning id`,
    [
      s1,
      user,
      JSON.stringify({
        op: 'and',
        rules: [
          { field: 'status', operator: 'in', value: [ids.todo1, ids.done1] },
          { field: 'priority', operator: 'in', value: [1] },
        ],
      }),
    ],
  );
  await q(
    `insert into activity (space_id, task_id, actor_id, kind, changes) values ($1, $2, $3, 'updated', $4::jsonb)`,
    [s1, ids.t1, user, JSON.stringify({ statusId: [ids.todo1, ids.done1] })],
  );
  await q(
    `insert into activity (space_id, task_id, actor_id, kind, changes) values ($1, $2, $3, 'label_added', $4::jsonb)`,
    [s1, ids.t1, user, JSON.stringify({ labelId: ids.bug1 })],
  );
  await q(`delete from changes`); // so that the only row after the migration is the one it writes
  j.entries = JSON.parse(
    readFileSync(join(drizzleDir, 'meta/_journal.json'), 'utf8'),
  ).entries.filter(
    (e: { idx: number }) => e.idx < 33, // up to 0032; 0033 (PJ-3) has its own test
  );
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp); // 0032
}, 120_000);

afterAll(async () => {
  await db?.$client.end();
  await admin?.query(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin?.end();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const names = async (table: string, project: string) =>
  (
    await q<{ name: string }>(`select name from ${table} where project_id = $1 order by name`, [
      project,
    ])
  ).map((r) => r.name);

describe('PJ-1 миграция 0032: статусы и метки пространства -> проекты', () => {
  it('PJ-1 каждый проект пространства получил копии всех статусов и меток пространства', async () => {
    expect(await names('statuses', ids.p1!)).toEqual(['Done', 'Todo']);
    expect(await names('statuses', ids.p2!)).toEqual(['Done', 'Todo']);
    expect(await names('statuses', ids.p3!)).toEqual(['Todo']);
    expect(await names('labels', ids.p1!)).toEqual(['Bug', 'Feat']);
    expect(await names('labels', ids.p2!)).toEqual(['Bug', 'Feat']);
    expect(await names('labels', ids.p3!)).toEqual(['Bug']);
    // copies keep name, category, color, rank
    expect(
      await one(
        `select category, color, rank from statuses where project_id = $1 and name = 'Done'`,
        [ids.p2],
      ),
    ).toEqual({ category: 'done', color: '#000', rank: 'a3' });
  });

  it('PJ-1 оригиналы удалены, пространство без проектов осталось без статусов и меток', async () => {
    expect(await q(`select 1 from statuses where project_id is null`)).toEqual([]);
    expect(
      await q(`select 1 from statuses where id in ($1, $2, $3, $4)`, [
        ids.todo1,
        ids.done1,
        ids.todo2,
        ids.s3st,
      ]),
    ).toEqual([]);
    expect(await q(`select 1 from labels where space_id = $1`, [ids.s3])).toEqual([]);
    expect(await q(`select 1 from statuses where space_id = $1`, [ids.s3])).toEqual([]);
    // 4 statuses + 4 copies of S1 into two projects ... = 2*2 + 1
    expect((await one(`select count(*)::int as n from statuses`)).n).toBe(5);
    expect((await one(`select count(*)::int as n from labels`)).n).toBe(5);
  });

  it('PJ-1 задачи и связи меток перепривязаны в проект задачи, ничего не потеряно', async () => {
    const t = (tid: string) =>
      one(
        `select s.name, s.project_id as sp, t.project_id as tp from tasks t join statuses s on s.id = t.status_id where t.id = $1`,
        [tid],
      );
    expect(await t(ids.t1!)).toMatchObject({ name: 'Todo', sp: ids.p1, tp: ids.p1 });
    expect(await t(ids.t2!)).toMatchObject({ name: 'Done', sp: ids.p2, tp: ids.p2 });
    expect(await t(ids.t3!)).toMatchObject({ name: 'Todo', sp: ids.p3, tp: ids.p3 });
    const links = await q<{ task_id: string; name: string; lp: string; tp: string }>(
      `select tl.task_id, l.name, l.project_id as lp, t.project_id as tp
       from task_labels tl join labels l on l.id = tl.label_id join tasks t on t.id = tl.task_id order by 1, 2`,
    );
    expect(links).toHaveLength(4);
    for (const l of links) expect(l.lp).toBe(l.tp);
    expect(links.filter((l) => l.task_id === ids.t1).map((l) => l.name)).toEqual(['Bug', 'Feat']);
  });

  it('PJ-1 ссылки модулей: gitlab, форма, правило автоматизаций (в т.ч. move_to_project — статус целевого проекта)', async () => {
    const stName = async (sid: string) =>
      one(`select name, project_id as p from statuses where id = $1`, [sid]);
    const g = await one(`select merged_status_id as s from gitlab_project_settings where id = $1`, [
      ids.p1,
    ]);
    expect(await stName(g.s!)).toMatchObject({ name: 'Done', p: ids.p1 });
    const f = await one(`select status_id as s from forms_forms where id = $1`, [ids.form]);
    expect(await stName(f.s!)).toMatchObject({ name: 'Todo', p: ids.p2 });

    type Json = { statusId: string; labelId: string; projectId: string };
    const r = await one<{
      trigger: { from: string[]; to: string[] };
      conditions: { rules: { value: string[] }[] };
      actions: Json[];
    }>(`select trigger, conditions, actions from automations_rules where id = $1`, [ids.rule]);
    const inP1 = async (sid: string, want: string) =>
      expect(await stName(sid)).toMatchObject({ name: want, p: ids.p1 });
    await inP1(r.trigger.from[0], 'Todo');
    await inP1(r.trigger.to[0], 'Done');
    const lab = async (lid: string) =>
      one(`select name, project_id as p from labels where id = $1`, [lid]);
    expect(await lab(r.conditions.rules[0].value[0])).toMatchObject({ name: 'Bug', p: ids.p1 });
    await inP1(r.actions[0].statusId, 'Done');
    expect(await lab(r.actions[1].labelId)).toMatchObject({ name: 'Feat', p: ids.p1 });
    expect(r.actions[2].projectId).toBe(ids.p2);
    expect(await stName(r.actions[2].statusId)).toMatchObject({ name: 'Todo', p: ids.p2 });
  });

  it('PJ-1 сохранённый вид: фильтр по статусам пространства -> копии во всех проектах пространства', async () => {
    const v = await one<{ filter: { rules: { field: string; value: unknown[] }[] } }>(
      `select filter from saved_views where id = $1`,
      [ids.view],
    );
    const st = v.filter.rules.find((r) => r.field === 'status')!;
    expect(st.value).toHaveLength(4); // Todo and Done in each of the two projects of S1
    const rows = await q(
      `select project_id, name from statuses where id = any($1::uuid[]) order by 1, 2`,
      [st.value],
    );
    expect(rows.map((r) => r.name).sort()).toEqual(['Done', 'Done', 'Todo', 'Todo']);
    expect(new Set(rows.map((r) => r.project_id))).toEqual(new Set([ids.p1, ids.p2]));
    expect(v.filter.rules.find((r) => r.field === 'priority')!.value).toEqual([1]);
  });

  it('PJ-1 журнал задачи: id статуса и метки в changes указывают на копии проекта задачи', async () => {
    const [u] = await q<{ changes: { statusId: string[] } }>(
      `select changes from activity where kind = 'updated' and task_id = $1`,
      [ids.t1],
    );
    const sts = await q(`select name, project_id from statuses where id = any($1::uuid[])`, [
      u!.changes.statusId,
    ]);
    expect(sts.map((s) => [s.name, s.project_id])).toEqual(
      expect.arrayContaining([
        ['Todo', ids.p1],
        ['Done', ids.p1],
      ]),
    );
    const [l] = await q<{ changes: { labelId: string } }>(
      `select changes from activity where kind = 'label_added' and task_id = $1`,
      [ids.t1],
    );
    expect(
      await one(`select name, project_id as p from labels where id = $1`, [l!.changes.labelId]),
    ).toMatchObject({
      name: 'Bug',
      p: ids.p1,
    });
  });

  it('PJ-1 доставка клиентам: одна глобальная строка _reset в changes -> reset на ближайшем pull', async () => {
    expect(await q(`select entity, op, space_id, user_id from changes`)).toEqual([
      { entity: '_reset', op: 'put', space_id: null, user_id: null },
    ]);
  });

  it('PJ-1 ограничения схемы: project_id обязателен, статусы и метки уходят вместе с проектом', async () => {
    await expect(
      q(
        `insert into statuses (space_id, name, category, color, rank) values ($1, 'x', 'todo', '#000', 'a')`,
        [ids.s1],
      ),
    ).rejects.toThrow(/project_id/);
    const p = await id(
      `insert into projects (space_id, name, key, rank) values ($1, 'Tmp', 'PTMP', 'a0') returning id`,
      [ids.s1],
    );
    await q(
      `insert into statuses (space_id, project_id, name, category, color, rank) values ($1, $2, 'x', 'todo', '#000', 'a')`,
      [ids.s1, p],
    );
    await q(`delete from projects where id = $1`, [p]);
    expect(await q(`select 1 from statuses where project_id = $1`, [p])).toEqual([]);
  });
});
