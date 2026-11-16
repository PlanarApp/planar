import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { api as importApi } from '@planar/module-import/api';
import { parseCsv } from '../../../../modules/import/api/csv.js';
import { parseDate, parsePriority } from '../../../../modules/import/api/parse.js';
import { loginFrom, projectKey } from '../../../../modules/import/api/resolve.js';
import { createApp } from '../../src/app.js';
import { settings } from '../../src/db/schema.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { executeMutations } from '../../src/sync/mutate.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { testDb, testDbUrl } from '../db.js';
import { key, taskArgs, useProject, world, type World } from '../sync/helpers.js';

const db = testDb();
const fx = (n: string) => readFileSync(join(__dirname, '../../../../e2e/fixtures/import', n));
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let adminCookie: string;
let outsiderCookie: string;
let guestCookie: string;
const [, TODO, DOING, DONE] = [0, 1, 2, 3];

const jobApi: JobApi & { queued: string[] } = {
  db,
  systemUserId: '',
  queued: [],
  execute: (u, m, o) => executeMutations(db, u, m, undefined, undefined, o),
  async enqueue(queue, data) {
    this.queued.push(`${queue}:${(data as { jobId?: string }).jobId}`);
  },
};
const run = importApi.jobs as { queue: string; handler(d: unknown, a: JobApi): Promise<void> }[];
const worker = run.find((j) => j.queue === 'import.run')!;
const sweep = run.find((j) => j.queue === 'import.sweep')!;

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ['import'] })
    .onConflictDoUpdate({ target: settings.id, set: { value: ['import'] } });
  // known fixture users: alice by email, bsmith by login
  await db.$client.query('update users set email = $1 where id = $2', [
    'Alice@Example.com',
    w.admin.userId,
  ]);
  await db.$client.query('update users set login = $1 where id = $2', ['BSmith', w.member.userId]);
  app = await createApp({
    databaseUrl: testDbUrl(),
    publicUrl: ORIGIN,
    dataDir: mkdtempSync(join(tmpdir(), 'planar-import-')),
    maxUploadMb: 1,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  adminCookie = await loginCookie(db, w.admin.userId);
  guestCookie = await loginCookie(db, w.guest.userId);
  const o = await createUser(db);
  outsiderCookie = await loginCookie(db, o.id);
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

function form(fields: Record<string, string>, file: Buffer | null, filename = 'f.csv') {
  const b = '----wk6' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields))
    parts.push(
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  if (file)
    parts.push(
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      file,
      Buffer.from('\r\n'),
    );
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${b}` };
}
const call = (
  method: 'GET' | 'POST',
  url: string,
  cookie: string,
  body?: ReturnType<typeof form>,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { cookie, origin: ORIGIN, ...(body && { 'content-type': body.contentType }) },
      payload: body?.payload,
    });
const preview = (file: Buffer, format: string, preset: string, cookie = adminCookie) =>
  call('POST', '/api/import/preview', cookie, form({ format, preset }, file));

async function project() {
  const id = uuidv7();
  await w.admin.ok('project.create', { id, spaceId: w.spaceId, name: 'P', key: key(), rank: 'a0' });
  useProject(w, id); // statuses belong to a project (PJ-1): w.statusIds are those of the latest project
  return id;
}
const smap = () => ({
  'to do': w.statusIds[TODO]!,
  'in progress': w.statusIds[DOING]!,
  complete: w.statusIds[DONE]!,
  Doing: w.statusIds[DOING]!,
  Done: w.statusIds[DONE]!,
});

/** create an import task via HTTP and run it with the worker */
async function doImport(
  projectId: string,
  file: Buffer,
  format: string,
  preset: string,
  mapping: object,
  cookie = adminCookie,
) {
  const res = await call(
    'POST',
    '/api/import/jobs',
    cookie,
    form({ projectId, format, preset, mapping: JSON.stringify(mapping) }, file),
  );
  expect(res.statusCode, res.body).toBe(202);
  const { data } = res.json();
  await worker.handler({ jobId: data.id }, jobApi);
  const got = await call('GET', `/api/import/jobs/${data.id}`, cookie);
  return got.json().data as {
    id: string;
    status: string;
    total: number;
    processed: number;
    created: number;
    updated: number;
    skipped: { row: number; reason: string }[];
    warnings: { row: number; message: string }[];
    error: string | null;
  };
}
const tasks = async (projectId: string) =>
  (
    await db.$client.query(
      'select *, due_date::text as due, start_date::text as start from tasks where project_id = $1 order by title',
      [projectId],
    )
  ).rows;
const one = async (projectId: string, title: string) =>
  (await tasks(projectId)).find((t) => t.title === title)!;
const assignees = async (id: string) =>
  (await db.$client.query('select user_id from task_assignees where task_id = $1', [id])).rows.map(
    (r) => r.user_id as string,
  );
const labelNames = async (id: string) =>
  (
    await db.$client.query(
      'select l.name from task_labels t join labels l on l.id = t.label_id where t.task_id = $1 order by 1',
      [id],
    )
  ).rows
    .map((r) => (r.name as string).toLowerCase())
    .sort();

const CU = {
  externalId: 'Task ID',
  title: 'Task Name',
  description: 'Task Content',
  status: 'Status',
  assignee: 'Assignees',
  labels: 'Tags',
  dueDate: 'Due Date',
  priority: 'Priority',
  parent: 'Parent ID',
};

describe('wk6: разбор', () => {
  it('plane: логин из имени и ключ проекта — латиница, формат, занятые с суффиксом', () => {
    const taken = new Set(['g.l']);
    expect(loginFrom('G L', taken)).toBe('g.l2');
    expect(loginFrom('Andrey Z.', taken)).toBe('andrey.z');
    expect(loginFrom('Юрий Щукин', taken)).toBe('yurij.schukin');
    expect(loginFrom('Я', taken)).toBe('ya');
    expect(loginFrom('X', taken)).toBe('userx');
    const keys = new Set(['TECH']);
    expect(projectKey('TECH', 'Engineering', keys)).toBe('TECH2');
    expect(projectKey(undefined, 'SEO Department', keys)).toBe('SEODEPARTM');
    expect(projectKey('', '1 Отдел', keys)).toBe('OTDEL');
    expect(projectKey(undefined, '—', keys)).toBe('PX');
  });

  it('wk6: CSV RFC 4180 — BOM, ; как разделитель, "" и переводы строк в кавычках, CRLF', () => {
    const t = '﻿a;b;c\r\n1;"x;y";"he said ""hi""\nline2"\r\n\r\n4;5;6';
    expect(parseCsv(t)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', 'he said "hi"\nline2'],
      ['4', '5', '6'],
    ]);
    expect(parseCsv('a,b\n1,')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });

  it('wk6: даты и приоритеты разных сервисов', () => {
    expect(parseDate('2025-11-20T12:00:00.000Z')).toBe('2025-11-20');
    expect(parseDate('1767268800000')).toBe('2026-01-01');
    expect(parseDate('1767268800')).toBe('2026-01-01');
    expect(parseDate('14/Oct/25 10:30 AM')).toBe('2025-10-14');
    expect(parseDate('01/15/2026')).toBe('2026-01-15');
    expect(parseDate('15.01.2026')).toBe('2026-01-15');
    expect(parseDate('31/Feb/25')).toBeNull();
    expect(parseDate('когда-нибудь')).toBeNull();
    expect([
      parsePriority('Urgent'),
      parsePriority('Normal'),
      parsePriority('Lowest'),
      parsePriority('2'),
      parsePriority('??'),
    ]).toEqual([1, 3, 4, 2, null]);
  });
});

describe('wk6: предпросмотр', () => {
  it('wk6: clickup — 20 строк из 25 и mapping по заготовке', async () => {
    const res = await preview(fx('clickup.csv'), 'csv', 'clickup');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.rows).toHaveLength(20);
    expect(b.columns).toContain('Task Name');
    expect(b.mapping).toMatchObject({
      externalId: 'Task ID',
      title: 'Task Name',
      description: 'Task Content',
      status: 'Status',
      assignee: 'Assignees',
      labels: 'Tags',
      dueDate: 'Due Date',
      priority: 'Priority',
      parent: 'Parent ID',
    });
  });

  it('wk6: jira, linear, trello — mapping по заготовке', async () => {
    const j = (await preview(fx('jira.csv'), 'csv', 'jira')).json();
    expect(j.rows).toHaveLength(8);
    expect(j.mapping).toMatchObject({
      externalId: 'Issue id',
      title: 'Summary',
      status: 'Status',
      assignee: 'Assignee',
      labels: 'Labels',
      dueDate: 'Due date',
      parent: 'Parent id',
      startDate: 'Custom field (Start date)',
    });
    const l = (await preview(fx('linear.csv'), 'csv', 'linear')).json();
    expect(l.mapping).toMatchObject({
      externalId: 'ID',
      title: 'Title',
      parent: 'Parent issue',
      dueDate: 'Due Date',
      priority: 'Priority',
    });
    const t = (await preview(fx('trello.json'), 'trello', 'trello')).json();
    expect(t.rows).toHaveLength(5);
    expect(t.mapping).toMatchObject({ externalId: 'id', title: 'name', status: 'list' });
    expect(t.rows[0]).toContain('To Do');
  });

  it('wk6: свой CSV — разделитель ; и общие синонимы колонок', async () => {
    const res = await preview(Buffer.from('﻿Name;Description;Assignee\nA;b;c\n'), 'csv', 'custom');
    expect(res.json()).toMatchObject({
      columns: ['Name', 'Description', 'Assignee'],
      mapping: { title: 'Name', description: 'Description', assignee: 'Assignee' },
    });
  });

  it('wk6: пределы и неверный ввод — 400, без входа — 401', async () => {
    const rows = 'Title\n' + 'x\n'.repeat(20_001);
    expect((await preview(Buffer.from(rows), 'csv', 'custom')).statusCode).toBe(400);
    expect(
      (await preview(Buffer.alloc(50 * 1024 * 1024 + 10, 97), 'csv', 'custom')).statusCode,
    ).toBe(400);
    expect((await preview(Buffer.from('a'), 'csv', 'trello')).statusCode).toBe(400);
    expect((await preview(Buffer.from('not json'), 'trello', 'trello')).statusCode).toBe(400);
    expect((await preview(Buffer.from('a'), 'csv', 'custom', '')).statusCode).toBe(401);
  });
});

describe('wk6: импорт', () => {
  it('wk6: clickup — задачи, статусы, метки, исполнители, подзадачи, отчёт о пропусках', async () => {
    const p = await project();
    const job = await doImport(p, fx('clickup.csv'), 'csv', 'clickup', {
      ...CU,
      statusMap: smap(),
    });
    expect(job).toMatchObject({
      status: 'done',
      total: 25,
      processed: 25,
      created: 24,
      updated: 0,
    });
    expect(job.skipped).toEqual([{ row: 8, reason: 'нет заголовка' }]);
    const ts = await tasks(p);
    expect(ts).toHaveLength(24);
    const t1 = await one(p, 'ClickUp task 1'); // status[1] = in progress, High, due 2026-01-01
    expect(t1.status_id).toBe(w.statusIds[DOING]);
    expect(t1.priority).toBe(2);
    expect(t1.due).toBe('2026-01-01');
    expect(await assignees(t1.id)).toEqual([w.admin.userId]); // by email, case-insensitive
    expect(await labelNames(t1.id)).toEqual(['bug', 'frontend']);
    const t2 = await one(p, 'ClickUp task 2'); // bsmith by login
    expect(await assignees(t2.id)).toEqual([w.member.userId]);
    expect(t2.description.content).toHaveLength(2);
    const t3 = await one(p, 'ClickUp task 3'); // unknown assignee
    expect(await assignees(t3.id)).toEqual([]);
    expect(job.warnings).toContainEqual({
      row: 4,
      message: 'исполнитель «nobody@example.com» не найден',
    });
    expect((await one(p, 'ClickUp task 9')).parent_id).toBe((await one(p, 'ClickUp task 8')).id);
    // label created once
    const l = await db.$client.query(
      "select count(*)::int c from labels where space_id = $1 and lower(name) = 'bug'",
      [w.spaceId],
    );
    expect(l.rows[0].c).toBe(1);
  });

  it('wk6: повторный импорт обновляет по внешнему ID, исполнители и метки заменяются полностью', async () => {
    const p = await project();
    await doImport(p, fx('clickup.csv'), 'csv', 'clickup', { ...CU, statusMap: smap() });
    const before = await one(p, 'ClickUp task 1');
    const edited = fx('clickup.csv')
      .toString()
      .replace('ClickUp task 1,', 'Renamed 1,')
      .replace('[alice@example.com],"[bug, Frontend]"', '[bsmith],"[ops]"');
    const job = await doImport(p, Buffer.from(edited), 'csv', 'clickup', {
      ...CU,
      statusMap: smap(),
    });
    expect(job).toMatchObject({ status: 'done', created: 0, updated: 24 });
    expect(await tasks(p)).toHaveLength(24);
    const after = await one(p, 'Renamed 1');
    expect(after.id).toBe(before.id);
    expect(await assignees(after.id)).toEqual([w.member.userId]);
    expect(await labelNames(after.id)).toEqual(['ops']);
  });

  it('wk6: без externalId строка всегда новая', async () => {
    const p = await project();
    const f = Buffer.from('Title\nA\nB\n');
    await doImport(p, f, 'csv', 'custom', { title: 'Title' });
    const job = await doImport(p, f, 'csv', 'custom', { title: 'Title' });
    expect(job.created).toBe(2);
    expect(await tasks(p)).toHaveLength(4);
  });

  it('wk6: jira — повторяющийся Labels, даты d/Mon/yy, приоритет, подзадачи по Issue id', async () => {
    const p = await project();
    const m = {
      externalId: 'Issue id',
      title: 'Summary',
      description: 'Description',
      status: 'Status',
      assignee: 'Assignee',
      labels: 'Labels',
      dueDate: 'Due date',
      startDate: 'Custom field (Start date)',
      priority: 'Priority',
      parent: 'Parent id',
      statusMap: { 'In Progress': w.statusIds[DOING]!, Done: w.statusIds[DONE]! },
    };
    const job = await doImport(p, fx('jira.csv'), 'csv', 'jira', m);
    expect(job).toMatchObject({ status: 'done', created: 8, skipped: [] });
    const t1 = await one(p, 'Jira issue 1'); // Medium? i%5=1 → High
    expect(t1.priority).toBe(2);
    expect(t1.due).toBe('2025-11-11');
    expect(await labelNames(t1.id)).toEqual(['backend', 'urgent']);
    expect(await assignees(t1.id)).toEqual([w.admin.userId]);
    expect((await one(p, 'Jira issue 4')).start).toBe('2025-11-01');
    expect((await one(p, 'Jira issue 6')).parent_id).toBe((await one(p, 'Jira issue 1')).id);
    expect((await one(p, 'Jira issue 1')).status_id).toBe(w.statusIds[DOING]);
  });

  it('plane — JSON-списки, родитель по Identifier, статусы по имени без statusMap', async () => {
    const p = await project();
    const { mapping } = (await preview(fx('plane.csv'), 'csv', 'plane')).json();
    expect(mapping).toMatchObject({
      externalId: 'Identifier',
      title: 'Name',
      status: 'State Name',
      assignee: 'Assignees',
      labels: 'Labels',
      startDate: 'Start Date',
      dueDate: 'Target Date',
      priority: 'Priority',
      parent: 'Parent',
    });
    const job = await doImport(p, fx('plane.csv'), 'csv', 'plane', mapping);
    expect(job).toMatchObject({ status: 'done', created: 3, skipped: [] });
    const t1 = await one(p, 'Plane issue 1');
    expect(t1).toMatchObject({ priority: 1, start: '2025-11-01', due: '2025-11-11' });
    expect(t1.status_id).toBe(w.statusIds[DONE]);
    expect(await labelNames(t1.id)).toEqual(['backend', 'баннер']);
    expect(await assignees(t1.id)).toEqual([w.admin.userId]);
    expect(job.warnings).toContainEqual({ row: 2, message: 'исполнитель «Ghost G.» не найден' });
    const t2 = await one(p, 'Plane issue 2');
    expect(t2.parent_id).toBe(t1.id);
    expect(t2.status_id).toBe(w.statusIds[DOING]);
    expect((await one(p, 'Plane issue 3')).status_id).toBe(w.statusIds[TODO]); // unknown → default
  });

  it('plane JSON — проекты по колонке, создание пользователей и проекта, комментарии от автора', async () => {
    const p = await project();
    const pv = (await preview(fx('plane.json'), 'csv', 'plane')).json();
    expect(pv.mapping).toMatchObject({
      externalId: 'identifier',
      title: 'name',
      description: 'description',
      status: 'state_name',
      assignee: 'assignees',
      dueDate: 'target_date',
      parent: 'parent',
      project: 'project_name',
      projectKey: 'project_identifier',
      comments: 'comments',
    });
    expect(pv.values).toEqual({
      status: ['Done', 'In Progress'],
      project: [
        { name: 'Engineering', key: 'TECH' },
        { name: 'SEO Department', key: 'PLSEO' },
      ],
      people: ['Alice Admin', 'G L', 'Nobody N.'],
    });
    const mapping = {
      ...pv.mapping,
      projectMap: { Engineering: p, 'SEO Department': 'new' },
      userMap: { 'G L': 'new', 'Alice Admin': w.admin.userId },
    };
    // creating users — instance admin only
    const res = await call(
      'POST',
      '/api/import/jobs',
      adminCookie,
      form(
        { projectId: p, format: 'csv', preset: 'plane', mapping: JSON.stringify(mapping) },
        fx('plane.json'),
      ),
    );
    expect(res.statusCode).toBe(403);
    // the refusal created nothing (the project is checked and created after the rights check)
    expect((await db.$client.query(`select 1 from projects where key like 'PLSEO%'`)).rows).toEqual(
      [],
    );
    await db.$client.query(`update users set role = 'admin' where id = $1`, [w.admin.userId]);
    try {
      const job = await doImport(p, fx('plane.json'), 'csv', 'plane', mapping);
      expect(job).toMatchObject({ status: 'done', created: 3, skipped: [] });
      const [gl] = (
        await db.$client.query(
          `select id, login, role, deactivated_at from users where name = 'G L'`,
        )
      ).rows;
      expect(gl).toMatchObject({ login: 'g.l', role: 'member', deactivated_at: null });
      const member = await db.$client.query(
        'select role from space_members where space_id = $1 and user_id = $2',
        [w.spaceId, gl.id],
      );
      expect(member.rows).toEqual([{ role: 'member' }]);

      const t1 = await one(p, 'Plane JSON 1');
      expect(t1.status_id).toBe(w.statusIds[DONE]);
      expect(JSON.stringify(t1.description)).toContain('вторая строка');
      expect((await assignees(t1.id)).sort()).toEqual([gl.id, w.admin.userId].sort());
      expect((await one(p, 'Plane JSON 2')).parent_id).toBe(t1.id);

      const [seo] = (
        await db.$client.query('select id, space_id from projects where key = $1', ['PLSEO'])
      ).rows;
      expect(seo).toMatchObject({ space_id: w.spaceId });
      const t3 = await one(seo.id, 'Plane JSON 3');
      expect(t3.parent_id).toBeNull(); // parent in another project
      expect(job.warnings).toContainEqual({
        row: 4,
        message: 'родитель «PJ-1» в другом проекте: не назначен',
      });
      const done = await db.$client.query(`select s.name from statuses s where s.id = $1`, [
        t3.status_id,
      ]);
      expect(done.rows).toEqual([{ name: 'Done' }]);
      expect(await labelNames(t3.id)).toEqual(['backend']);

      const cs = (
        await db.$client.query(
          'select author_id, body from comments where task_id = $1 order by created_at, id',
          [t1.id],
        )
      ).rows;
      expect(cs.map((c) => c.author_id)).toEqual(expect.arrayContaining([gl.id, w.admin.userId]));
      const text = (c: { body: unknown }) => JSON.stringify(c.body);
      expect(cs).toHaveLength(3);
      expect(text(cs.find((c) => c.author_id === gl.id)!)).toContain('2025-10-14 10:31');
      // an author not found — on behalf of the importer, the name in the first line
      expect(
        cs
          .filter((c) => c.author_id === w.admin.userId)
          .map(text)
          .join(),
      ).toContain('2025-10-16 12:00 · Nobody N.');
      // PLNRAPP-247: assignments and comments of an import — no notifications, but assignees watch the task
      const q1 = (s: string) => db.$client.query(s, [t1.id]).then((r) => r.rows);
      expect(await q1('select id from notifications where task_id = $1')).toEqual([]);
      expect(
        (await q1('select user_id from task_watchers where task_id = $1')).map((r) => r.user_id),
      ).toEqual(expect.arrayContaining([gl.id, w.admin.userId]));
    } finally {
      await db.$client.query(`update users set role = 'member' where id = $1`, [w.admin.userId]);
    }
  });

  it('пустое пространство: без проекта — проекты по колонке, статусы создаются в каждом проекте', async () => {
    const spaceId = uuidv7();
    await w.admin.ok('space.create', {
      id: spaceId,
      name: 'Empty',
      rank: 'b0',
      memberId: uuidv7(),
    });
    const file = Buffer.from(
      JSON.stringify([
        { project: 'Alpha', key: 'PLALPHA', id: 'E-1', name: 'Empty 1', state: 'Test dev' },
        { project: 'Alpha', key: 'PLALPHA', id: 'E-2', name: 'Empty 2', state: 'Done' },
        { project: 'Beta', key: 'PLBETA', id: 'E-3', name: 'Empty 3', state: 'Test dev' },
        { project: '', key: '', id: 'E-4', name: 'Empty 4', state: 'Done' },
      ]),
    );
    const mapping = {
      externalId: 'id',
      title: 'name',
      status: 'state',
      project: 'project',
      projectKey: 'key',
      projectMap: { Alpha: 'new', Beta: 'new' },
      statusNew: { 'Test dev': 'in_progress', Done: 'done' },
    };
    const post = (fields: Record<string, string>) =>
      call('POST', '/api/import/jobs', adminCookie, form(fields, file, 'f.json'));
    const base = { format: 'csv', preset: 'custom', mapping: JSON.stringify(mapping) };
    expect((await post(base)).statusCode).toBe(400); // neither a project nor a space
    const noCol = JSON.stringify({ ...mapping, project: undefined, projectMap: undefined });
    expect((await post({ ...base, spaceId, mapping: noCol })).statusCode).toBe(400);
    const res = await post({ ...base, spaceId });
    expect(res.statusCode, res.body).toBe(202);
    const { data } = res.json();
    expect(data).toMatchObject({ projectId: null, spaceId });
    await worker.handler({ jobId: data.id }, jobApi);
    const job = (await call('GET', `/api/import/jobs/${data.id}`, adminCookie)).json().data;
    expect(job).toMatchObject({
      status: 'done',
      created: 3,
      skipped: [{ row: 5, reason: 'нет проекта' }],
    });
    const projectOf = async (k: string) =>
      (await db.$client.query('select id, space_id from projects where key = $1', [k])).rows[0];
    const alpha = await projectOf('PLALPHA');
    const beta = await projectOf('PLBETA');
    expect([alpha.space_id, beta.space_id]).toEqual([spaceId, spaceId]);
    const statusOf = async (title: string) =>
      (
        await db.$client.query(
          'select s.name, s.category, s.project_id from tasks t join statuses s on s.id = t.status_id where t.title = $1',
          [title],
        )
      ).rows[0];
    // «Test dev» is created in each project once; «Done» exists in a new project — not created
    expect(await statusOf('Empty 1')).toEqual({
      name: 'Test dev',
      category: 'in_progress',
      project_id: alpha.id,
    });
    expect(await statusOf('Empty 3')).toMatchObject({ name: 'Test dev', project_id: beta.id });
    expect(await statusOf('Empty 2')).toMatchObject({ name: 'Done', category: 'done' });
    const names = await db.$client.query(
      `select project_id, count(*)::int as n from statuses where project_id in ($1, $2) and name = 'Test dev' group by 1`,
      [alpha.id, beta.id],
    );
    expect(names.rows.map((r) => r.n)).toEqual([1, 1]);
    // the new status goes after the last in_progress one, before done
    const order = (
      await db.$client.query(
        `select name from statuses where project_id = $1 order by rank collate "C"`,
        [alpha.id],
      )
    ).rows.map((r) => r.name);
    expect(order).toEqual(['Backlog', 'Todo', 'In Progress', 'Test dev', 'Done', 'Cancelled']);
  });

  it('wk6: linear — приоритеты словами, ISO-даты, родитель по ID', async () => {
    const p = await project();
    const m = {
      externalId: 'ID',
      title: 'Title',
      description: 'Description',
      status: 'Status',
      assignee: 'Assignee',
      labels: 'Labels',
      dueDate: 'Due Date',
      priority: 'Priority',
      parent: 'Parent issue',
    };
    const job = await doImport(p, fx('linear.csv'), 'csv', 'linear', m);
    expect(job).toMatchObject({ status: 'done', created: 8 });
    expect((await one(p, 'Linear issue 1')).priority).toBe(1); // i%5=1 → Urgent
    expect((await one(p, 'Linear issue 8')).parent_id).toBe((await one(p, 'Linear issue 1')).id);
    expect(await labelNames((await one(p, 'Linear issue 1')).id)).toEqual(['bug', 'improvement']);
  });

  it('wk6: trello — списки → статусы, метки (без имени — цвет), участники, чек-лист, архив и пустые пропущены', async () => {
    const p = await project();
    const job = await doImport(p, fx('trello.json'), 'trello', 'trello', {
      ...(await preview(fx('trello.json'), 'trello', 'trello')).json().mapping,
      statusMap: smap(),
    });
    expect(job).toMatchObject({ status: 'done', total: 5, created: 3 });
    expect(job.skipped).toEqual([
      { row: 4, reason: 'карточка в архиве' },
      { row: 5, reason: 'нет заголовка' },
    ]);
    const c1 = await one(p, 'Trello card 1');
    expect(c1.status_id).toBe(w.statusIds[TODO]); // "To Do" is not in statusMap → default
    expect((await one(p, 'Trello card 2')).status_id).toBe(w.statusIds[DOING]);
    expect(await labelNames(c1.id)).toEqual(['bug', 'green']);
    expect(await assignees(c1.id)).toEqual([w.member.userId]);
    expect(job.warnings).toContainEqual({ row: 2, message: 'исполнитель «ghost» не найден' });
    const cl = (
      await db.$client.query(
        'select text, done from checklist_items where task_id = $1 order by rank',
        [c1.id],
      )
    ).rows;
    expect(cl).toEqual([
      { text: 'Первый шаг', done: true },
      { text: 'Второй шаг', done: false },
    ]);
  });

  it('wk6: ошибка мутатора пропускает только свою строку', async () => {
    const p = await project();
    const foreign = uuidv7(); // status does not exist → task.create rejected
    const f = Buffer.from('Title,St\nok1,a\nbad,b\nok2,a\n');
    const job = await doImport(p, f, 'csv', 'custom', {
      title: 'Title',
      status: 'St',
      statusMap: { a: w.statusIds[TODO]!, b: foreign },
    });
    expect(job).toMatchObject({ status: 'done', total: 3, processed: 3, created: 2 });
    expect(job.skipped).toHaveLength(1);
    expect(job.skipped[0]).toMatchObject({ row: 3 });
    expect((await tasks(p)).map((t) => t.title)).toEqual(['ok1', 'ok2']);
  });

  it('wk6: пачки по 100 — processed доходит до total на файле в 250 строк', async () => {
    const p = await project();
    const f = Buffer.from('Title\n' + Array.from({ length: 250 }, (_, i) => `T${i}`).join('\n'));
    const job = await doImport(p, f, 'csv', 'custom', { title: 'Title' });
    expect(job).toMatchObject({ status: 'done', total: 250, processed: 250, created: 250 });
    expect(new Set((await tasks(p)).map((t) => t.rank)).size).toBe(250);
  });

  it('wk6: неверная колонка в mapping — 400; без прав на проект — 404; чужое задание — 404', async () => {
    const p = await project();
    const f = Buffer.from('Title\nA\n');
    const mk = (cookie: string, fields: Record<string, string>) =>
      call(
        'POST',
        '/api/import/jobs',
        cookie,
        form({ projectId: p, format: 'csv', preset: 'custom', ...fields }, f),
      );
    expect(
      (await mk(adminCookie, { mapping: JSON.stringify({ title: 'Нет такой' }) })).statusCode,
    ).toBe(400);
    expect((await mk(adminCookie, { mapping: '{' })).statusCode).toBe(400);
    const ok = { mapping: JSON.stringify({ title: 'Title' }) };
    expect((await mk(outsiderCookie, ok)).statusCode).toBe(404);
    expect((await mk(guestCookie, ok)).statusCode).toBe(404);
    const res = await mk(adminCookie, ok);
    expect(res.statusCode).toBe(202);
    const id = res.json().data.id;
    expect(res.json().data).toMatchObject({ status: 'pending', total: 1, processed: 0 });
    expect(res.json().data.source).toBeUndefined();
    expect((await call('GET', `/api/import/jobs/${id}`, outsiderCookie)).statusCode).toBe(404);
    expect((await call('GET', `/api/import/jobs/${id}`, adminCookie)).statusCode).toBe(200);
  });

  it('wk6: sweep ставит pending в очередь, воркер не запускает задание дважды', async () => {
    const p = await project();
    const res = await call(
      'POST',
      '/api/import/jobs',
      adminCookie,
      form(
        { projectId: p, format: 'csv', preset: 'custom', mapping: '{"title":"Title"}' },
        Buffer.from('Title\nA\n'),
      ),
    );
    const id = res.json().data.id;
    jobApi.queued.length = 0;
    await sweep.handler({}, jobApi);
    expect(jobApi.queued).toContain(`import.run:${id}`);
    await Promise.all([
      worker.handler({ jobId: id }, jobApi),
      worker.handler({ jobId: id }, jobApi),
    ]);
    expect(await tasks(p)).toHaveLength(1);
    expect((await call('GET', `/api/import/jobs/${id}`, adminCookie)).json().data).toMatchObject({
      status: 'done',
      created: 1,
    });
  });

  it('wk6: права пользователя — участник без записи в проект получает failed только через 404 на создании', async () => {
    // a job from a user who lost rights after enqueue creates no tasks and does not break the worker
    const p = await project();
    const res = await call(
      'POST',
      '/api/import/jobs',
      adminCookie,
      form(
        { projectId: p, format: 'csv', preset: 'custom', mapping: '{"title":"Title"}' },
        Buffer.from('Title\nA\n'),
      ),
    );
    await db.$client.query(
      'update space_members set role = $1 where space_id = $2 and user_id = $3',
      ['guest', w.spaceId, w.admin.userId],
    );
    try {
      await worker.handler({ jobId: res.json().data.id }, jobApi);
    } finally {
      await db.$client.query(
        'update space_members set role = $1 where space_id = $2 and user_id = $3',
        ['admin', w.spaceId, w.admin.userId],
      );
    }
    const job = (await call('GET', `/api/import/jobs/${res.json().data.id}`, adminCookie)).json()
      .data;
    expect(job.status).toBe('done');
    expect(job.created).toBe(0);
    expect(job.skipped).toHaveLength(1);
    expect(await tasks(p)).toHaveLength(0);
  });

  it('wk6: ранги новых задач — после существующих задач статуса', async () => {
    const p = await project();
    const a = taskArgs(w, { projectId: p, statusId: w.statusIds[4], rank: 'a5' });
    await w.admin.ok('task.create', a);
    await doImport(p, Buffer.from('Title,S\nN1,x\nN2,x\nN3,x\n'), 'csv', 'custom', {
      title: 'Title',
      status: 'S',
      statusMap: { x: w.statusIds[4]! },
    });
    const ranks = (await tasks(p)).filter((t) => t.id !== a.id).map((t) => t.rank as string);
    expect(ranks.sort()).toEqual(['a6', 'a7', 'a8']);
  });
});
