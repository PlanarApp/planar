// PLNRAPP-500: the engines monitor — passes and their steps (tracked), the abort of a manual run, 7 days of history,
// REST api/ai/engines (who sees, filters, the manual run of a workspace admin), the autopilot fields saved apart.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { EngineAborted, sweep, tracked } from '@planar/module-ai/api';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { world, type World } from '../sync/helpers.js';

useApp();

let w: World;
const cookies: Record<string, string> = {};

const call = (method: string, url: string, who: string, body?: unknown) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/ai/${url}`,
      payload: body as object | undefined,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const runOf = async (id: string) =>
  (await raw(`select * from ai_engine_runs where id = $1`, [id]))[0]!;
const pass = async (o: Record<string, unknown>) => {
  const id = uuidv7();
  await raw(
    `insert into ai_engine_runs (id, engine, job, project_id, trigger, state, processed, error, started_at, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()), case when $6 = 'running' then null else now() end)`,
    [
      id,
      o.engine ?? 'tasks',
      o.job ?? 'reconcile',
      o.projectId ?? null,
      o.trigger ?? 'cron',
      o.state ?? 'done',
      o.processed ?? 0,
      o.error ?? null,
      o.startedAt ?? null,
    ],
  );
  return id;
};

beforeAll(async () => {
  w = await world(db);
  cookies.root = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  for (const c of ['admin', 'member'] as const) cookies[c] = await loginCookie(db, w[c].userId);
  await w.admin.ok('project.setModule', { projectId: w.projectId, moduleId: 'ai', enabled: true });
});
afterAll(async () => {
  await raw(`delete from ai_engine_runs`);
});

describe('проход движка (tracked)', () => {
  it('шаги — в живой лог, итог — done с числом обработанных', async () => {
    let id = '';
    await tracked(db, { engine: 'tasks', job: 'reconcile', trigger: 'cron' }, async (t) => {
      id = t.id;
      expect((await runOf(id)).state).toBe('running');
      await t.step('шаг 1', { projectId: w.projectId, level: 'action' });
      expect((await runOf(id)).current).toBe('шаг 1');
      t.count(2);
    });
    const r = await runOf(id);
    expect(r).toMatchObject({ state: 'done', processed: 2, current: null, error: null });
    expect(r.finished_at).not.toBeNull();
    const ev = await raw(`select level, text, project_id from ai_engine_events where run_id = $1`, [
      id,
    ]);
    expect(ev).toEqual([{ level: 'action', text: 'шаг 1', project_id: w.projectId }]);
  });

  it('ошибка — failed с текстом, исключение летит дальше', async () => {
    let id = '';
    await expect(
      tracked(db, { engine: 'harness', job: 'retro', trigger: 'event' }, async (t) => {
        id = t.id;
        throw new Error('сломалось');
      }),
    ).rejects.toThrow('сломалось');
    expect(await runOf(id)).toMatchObject({ state: 'failed', error: 'сломалось' });
  });

  it('прерванный проход останавливается на следующем шаге и остаётся aborted', async () => {
    let id = '';
    let after = false;
    await tracked(db, { engine: 'tasks', job: 'reconcile', trigger: 'cron' }, async (t) => {
      id = t.id;
      t.count();
      await raw(`update ai_engine_runs set state = 'aborted' where id = $1`, [id]);
      await t.check();
      after = true;
    });
    expect(after).toBe(false);
    expect(await runOf(id)).toMatchObject({ state: 'aborted', processed: 1 });
    expect(new EngineAborted().message).toContain('ручным');
  });

  it('уборка: старше 7 дней — удаляются, молчащий running — failed', async () => {
    const old = await pass({ startedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    const lost = await pass({ state: 'running' });
    await raw(`update ai_engine_runs set updated_at = now() - interval '1 hour' where id = $1`, [
      lost,
    ]);
    const fresh = await pass({});
    await sweep(db);
    expect(await raw(`select id from ai_engine_runs where id = $1`, [old])).toEqual([]);
    expect((await runOf(lost)).state).toBe('failed');
    expect((await runOf(fresh)).state).toBe('done');
  });
});

describe('REST api/ai/engines', () => {
  it('монитор: админ проекта и админ воркспейса видят, участник — 403; запуск — только админ воркспейса', async () => {
    const q = `engines/monitor?projectId=${w.projectId}`;
    expect((await call('GET', q, 'member')).statusCode).toBe(403);
    const a = await call('GET', q, 'admin');
    expect(a.statusCode).toBe(200);
    expect(a.json().canRun).toBe(false);
    expect(a.json().engines.map((e: { engine: string }) => e.engine)).toEqual(['tasks', 'harness']);
    expect((await call('GET', q, 'root')).json().canRun).toBe(true);
    // the whole workspace — an instance admin only
    expect((await call('GET', 'engines/monitor', 'admin')).statusCode).toBe(403);
    expect((await call('GET', 'engines/monitor', 'root')).statusCode).toBe(200);
  });

  it('карточка: идущий проход — running с текущим действием; чужой проект его не видит', async () => {
    const other = uuidv7();
    const id = await pass({ engine: 'harness', job: 'retro', state: 'running', projectId: other });
    await raw(
      `update ai_engine_runs set current = 'секрет', current_project_id = $2 where id = $1`,
      [id, other],
    );
    const card = (who: string) =>
      call('GET', `engines/monitor?projectId=${w.projectId}`, who).then((r) =>
        r.json().engines.find((e: { engine: string }) => e.engine === 'harness'),
      );
    expect(await card('admin')).toMatchObject({ status: 'running', current: null });
    expect((await call('GET', 'engines/monitor', 'root')).json().engines[1]).toMatchObject({
      status: 'running',
      current: 'секрет',
    });
    await raw(
      `update ai_engine_runs set state = 'failed', error = 'упал', finished_at = now() where id = $1`,
      [id],
    );
    expect(await card('admin')).toMatchObject({ status: 'error', lastError: 'упал' });
  });

  it('живой лог: курсор after отдаёт только новые события своего проекта и общие', async () => {
    let id = '';
    await tracked(db, { engine: 'tasks', job: 'reap', trigger: 'cron' }, async (t) => {
      id = t.id;
      await t.step('общий');
      await t.step('свой', { projectId: w.projectId });
      await t.step('чужой', { projectId: uuidv7() });
    });
    const all = (await call('GET', `engines/monitor?projectId=${w.projectId}`, 'admin')).json()
      .events as { id: string; text: string; runId: string }[];
    const mine = all.filter((e) => e.runId === id).map((e) => e.text);
    expect(mine).toEqual(['общий', 'свой']);
    const last = all.at(-1)!.id;
    expect(
      (await call('GET', `engines/monitor?projectId=${w.projectId}&after=${last}`, 'admin')).json()
        .events,
    ).toEqual([]);
  });

  it('история: фильтры движок, результат, проект, период, «только с действиями»', async () => {
    const mine = await pass({ engine: 'harness', projectId: w.projectId, processed: 3 });
    const failed = await pass({ engine: 'tasks', state: 'failed', error: 'x' });
    const empty = await pass({ engine: 'tasks', processed: 0 });
    const ids = async (qs: string) =>
      (await call('GET', `engines/runs?projectId=${w.projectId}&${qs}`, 'admin'))
        .json()
        .runs.map((r: { id: string }) => r.id) as string[];
    expect(await ids('only=project')).toContain(mine);
    expect(await ids('only=project')).not.toContain(failed);
    expect(await ids('engine=tasks&state=failed')).toContain(failed);
    expect(await ids('engine=tasks&state=failed')).not.toContain(empty);
    expect(await ids('active=1')).not.toContain(empty);
    expect(await ids('active=1')).toContain(failed);
    expect(await ids(`since=${new Date(Date.now() + 60_000).toISOString()}`)).toEqual([]);
    const r = (
      await call('GET', `engines/runs?projectId=${w.projectId}&only=project`, 'admin')
    ).json().runs[0];
    expect(r).toMatchObject({ id: mine, projectName: 'P', processed: 3, state: 'done' });
    expect(r.startedAt).toBeTruthy();
    expect(r.finishedAt).toBeTruthy();
    // pages by the cursor
    const p1 = (await call('GET', `engines/runs?projectId=${w.projectId}&limit=1`, 'admin')).json();
    expect(p1.runs).toHaveLength(1);
    const p2 = (
      await call(
        'GET',
        `engines/runs?projectId=${w.projectId}&limit=1&cursor=${encodeURIComponent(p1.next)}`,
        'admin',
      )
    ).json();
    expect(p2.runs[0].id).not.toBe(p1.runs[0].id);
  });

  it('ручной запуск: админ проекта — 403; админ воркспейса прерывает идущий проход движка', async () => {
    const body = { engine: 'tasks', projectId: w.projectId };
    expect((await call('POST', 'engines/run', 'admin', body)).statusCode).toBe(403);
    const running = await pass({ engine: 'tasks', state: 'running' });
    const other = await pass({ engine: 'harness', state: 'running' });
    const r = await call('POST', 'engines/run', 'root', body);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ aborted: 1, queued: 1 });
    expect((await runOf(running)).state).toBe('aborted');
    expect((await runOf(other)).state).toBe('running');
    expect(
      (await call('POST', 'engines/run', 'root', { engine: 'tasks', projectId: uuidv7() }))
        .statusCode,
    ).toBe(404);
    await raw(`update ai_engine_runs set state = 'done' where id = $1`, [other]);
  });
});

describe('настройки автопилота сохраняются отдельно от лимитов', () => {
  it('PUT limits без токенов и стоимости их не трогает', async () => {
    const q = `limits?projectId=${w.projectId}`;
    await call('PUT', q, 'admin', { dailyTokens: 1000, dailyCost: 5 });
    const r = await call('PUT', q, 'admin', { autopilot: true, dailyTasks: 7 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      dailyTokens: 1000,
      dailyCost: 5,
      dailyTasks: 7,
      autopilot: true,
    });
    const l = await call('PUT', q, 'admin', { dailyTokens: null, dailyCost: null });
    expect(l.json()).toMatchObject({
      dailyTokens: null,
      dailyCost: null,
      dailyTasks: 7,
      autopilot: true,
    });
  });
});
