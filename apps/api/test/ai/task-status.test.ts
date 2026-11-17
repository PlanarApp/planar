// PLNRAPP-319: GET api/ai/status/projects/:projectId — the AI status of the tasks for the list and the board.
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
const cookies: Record<string, string> = {};

const call = (projectId: string, who: string) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'GET',
      url: `/api/ai/status/projects/${projectId}`,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
const newTask = async () => {
  const a = taskArgs(w, {});
  await w.admin.ok('task.create', a);
  return a.id as string;
};
/** a run of the task; `ago` — minutes since its creation and last change */
const run = async (taskId: string, state: string, ago: number, log = '') => {
  const id = uuidv7();
  await raw(
    `insert into ai_runs (id, task_id, project_id, kind, item_id, state, chain_id, chain_depth, log,
       created_at, updated_at)
     values ($1, $2, $3, 'action', null, $4, $1, 0, $5, now() - make_interval(mins => $6::int),
       now() - make_interval(mins => $6::int))`,
    [id, taskId, w.projectId, state, log, ago],
  );
  return id;
};
type Status = {
  taskId: string;
  status: string;
  runId: string;
  finishedAt: string | null;
  error: string | null;
};
const byTask = (r: { json(): { statuses: Status[] } }) =>
  new Map(r.json().statuses.map((s) => [s.taskId, s]));

beforeAll(async () => {
  w = await world(db);
  for (const c of ['admin', 'member', 'outsider'] as const)
    cookies[c] = await loginCookie(db, w[c].userId);
  await w.admin.ok('project.setModule', { projectId: w.projectId, moduleId: 'ai', enabled: true });
});

describe('статус ИИ задач проекта', () => {
  it('running / failed до успешного запуска / none — одним ответом на все задачи', async () => {
    // one by one: parallel pushes of one client skip the mutations with a lower id as replays
    const tasks: string[] = [];
    for (let i = 0; i < 7; i++) tasks.push(await newTask());
    const [running, failed, cancelledAfter, repaired, done, none, failedThenRunning] = tasks as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    await run(running, 'failed', 30);
    const runningRun = await run(running, 'running', 5);
    const failedRun = await run(failed, 'failed', 10, 'начало\nошибка: таймаут\n');
    await run(failed, 'waiting_human', 40);
    // a cancelled run after a failure is not a success: failed holds
    const failedRun2 = await run(cancelledAfter, 'failed', 20, 'ошибка: x\n');
    await run(cancelledAfter, 'cancelled', 5);
    // a successful run after the failure clears it
    await run(repaired, 'failed', 20);
    await run(repaired, 'done', 10);
    await run(done, 'done', 10);
    // a run in progress wins over a later failure
    const running2 = await run(failedThenRunning, 'running', 30);
    await run(failedThenRunning, 'failed', 5);

    const r = await call(w.projectId, 'admin');
    expect(r.statusCode).toBe(200);
    const m = byTask(r);
    expect(m.get(running)).toMatchObject({
      status: 'running',
      runId: runningRun,
      finishedAt: null,
    });
    expect(m.get(failed)).toMatchObject({
      status: 'failed',
      runId: failedRun,
      error: 'ошибка: таймаут',
    });
    expect(m.get(failed)!.finishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(m.get(cancelledAfter)).toMatchObject({ status: 'failed', runId: failedRun2 });
    expect(m.get(failedThenRunning)).toMatchObject({ status: 'running', runId: running2 });
    for (const t of [repaired, done, none]) expect(m.has(t)).toBe(false);

    // the member sees the project, but not the runs of the admin's task (D7): no error text
    const mr = await call(w.projectId, 'member');
    expect(mr.statusCode).toBe(200);
    expect(byTask(mr).get(failed)).toMatchObject({ status: 'failed', error: null });
  });

  it('не видящему проект, несуществующему и без модуля ai — 404', async () => {
    const r = await call(w.projectId, 'outsider');
    expect(r.statusCode).toBe(404);
    expect((await call(uuidv7(), 'member')).json()).toEqual(r.json());
    expect((await call('not-a-uuid', 'member')).statusCode).toBe(404);
    await raw(`update projects set modules = array_remove(modules, 'ai') where id = $1`, [
      w.projectId,
    ]);
    try {
      expect((await call(w.projectId, 'admin')).statusCode).toBe(404);
    } finally {
      await raw(`update projects set modules = array_append(modules, 'ai') where id = $1`, [
        w.projectId,
      ]);
    }
  });
});
