import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { api as importApi, rankAt, succRank } from '@planar/module-import/api';
import { parseCsv } from '../../../../modules/import/api/csv.js';
import { parseDate, parsePriority } from '../../../../modules/import/api/parse.js';
import { createApp } from '../../src/app.js';
import { settings } from '../../src/db/schema.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { executeMutations } from '../../src/sync/mutate.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { testDb, testDbUrl } from '../db.js';
import { key, taskArgs, world, type World } from '../sync/helpers.js';

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
  // известные пользователи фикстур: alice по email, bsmith по login
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
  return id;
}
const smap = () => ({
  'to do': w.statusIds[TODO]!,
  'in progress': w.statusIds[DOING]!,
  complete: w.statusIds[DONE]!,
  Doing: w.statusIds[DOING]!,
  Done: w.statusIds[DONE]!,
});

/** создать задачу импорта через HTTP и выполнить её воркером */
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

  it('wk6: ранги — допустимые ключи fractional-indexing, возрастают', () => {
    const r = Array.from({ length: 5000 }, (_, i) => rankAt(i));
    expect(r.slice(0, 3)).toEqual(['a0', 'a1', 'a2']);
    expect(r[62]).toBe('b00');
    expect([...r].sort()).toEqual(r);
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
      (await preview(Buffer.alloc(10 * 1024 * 1024 + 10, 97), 'csv', 'custom')).statusCode,
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
    expect(await assignees(t1.id)).toEqual([w.admin.userId]); // по email без регистра
    expect(await labelNames(t1.id)).toEqual(['bug', 'frontend']);
    const t2 = await one(p, 'ClickUp task 2'); // bsmith по login
    expect(await assignees(t2.id)).toEqual([w.member.userId]);
    expect(t2.description.content).toHaveLength(2);
    const t3 = await one(p, 'ClickUp task 3'); // неизвестный исполнитель
    expect(await assignees(t3.id)).toEqual([]);
    expect(job.warnings).toContainEqual({
      row: 4,
      message: 'исполнитель «nobody@example.com» не найден',
    });
    expect((await one(p, 'ClickUp task 9')).parent_id).toBe((await one(p, 'ClickUp task 8')).id);
    // метка создана один раз
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
    expect(c1.status_id).toBe(w.statusIds[TODO]); // «To Do» нет в statusMap → по умолчанию
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
    const foreign = uuidv7(); // статус не существует → task.create отклонён
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
    // задание от пользователя, лишённого прав после постановки, не создаёт задач и не роняет воркер
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
    expect([
      succRank(null),
      succRank('a0'),
      succRank('a5V'),
      succRank('az'),
      succRank('b0z'),
    ]).toEqual(['a0', 'a1', 'a6', 'b00', 'b10']);
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
