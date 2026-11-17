// PLNRAPP-403: GET api/ai/reports/usage — the cost of the finished runs by task / by day.
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
const cookies: Record<string, string> = {};
let t1: string; // created by the admin, no assignees: the member does not see its runs (D7)
let t2: string; // the member's own task

const call = (qs: string, who: string) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'GET',
      url: `/api/ai/reports/usage?${qs}`,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
/** a finished run: started `day` UTC at 10:00, lasted `sec` seconds */
const run = (taskId: string, day: string, sec: number, inTok: number, cost: number | null) => {
  const id = uuidv7();
  return raw(
    `insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth, input_tokens, output_tokens,
       cost, started_at, finished_at, created_at, updated_at)
     values ($1, $2, $3, 'comment', 'done', $1, 0, $4, 1, $5, $6::timestamptz, $6::timestamptz + make_interval(secs => $7),
       $6::timestamptz, $6::timestamptz)`,
    [id, taskId, w.projectId, inTok, cost, `${day}T10:00:00Z`, sec],
  );
};
const period = 'from=2026-03-01T00:00:00Z&to=2026-03-10T00:00:00Z';

beforeAll(async () => {
  w = await world(db);
  for (const c of ['admin', 'member', 'outsider'] as const)
    cookies[c] = await loginCookie(db, w[c].userId);
  await w.admin.ok('project.setModule', { projectId: w.projectId, moduleId: 'ai', enabled: true });
  const a = taskArgs(w, {});
  await w.admin.ok('task.create', a);
  t1 = a.id as string;
  const b = taskArgs(w, {});
  await w.member.ok('task.create', b);
  t2 = b.id as string;
  await run(t1, '2026-03-02', 60, 100, 0.5);
  await run(t1, '2026-03-02', 30, 50, null);
  await run(t2, '2026-03-05', 10, 10, 0.25);
  await run(t2, '2026-03-10', 99, 999, 9); // `to` is exclusive
  await run(t2, '2026-02-28', 99, 999, 9);
});

describe('отчёт затрат ИИ', () => {
  it('по задачам и по дням: суммы, итог; граница to не входит', async () => {
    const q = `projectId=${w.projectId}&${period}`;
    const admin = (await call(`${q}&groupBy=task`, 'admin')).json();
    expect(admin.rows).toHaveLength(2);
    expect(admin.rows[0]).toMatchObject({
      key: t1,
      runs: 2,
      seconds: 90,
      inputTokens: 150,
      outputTokens: 2,
      cost: 0.5,
    });
    expect(admin.rows[0].label).toMatch(/^K\w+-\d+ /);
    expect(admin.total).toMatchObject({ runs: 3, seconds: 100, inputTokens: 160, cost: 0.75 });
    const days = (await call(`${q}&groupBy=day`, 'admin')).json();
    expect(days.rows.map((r: { key: string }) => r.key)).toEqual(['2026-03-05', '2026-03-02']);
    expect(days.rows[1]).toMatchObject({ label: '2026-03-02', runs: 2, seconds: 90 });
  });

  it('участник видит только затраты своих задач (D7); по пространству — то же', async () => {
    const r = (await call(`projectId=${w.projectId}&${period}&groupBy=task`, 'member')).json();
    expect(r.rows.map((x: { key: string }) => x.key)).toEqual([t2]);
    const s = (await call(`spaceId=${w.spaceId}&${period}&groupBy=task`, 'member')).json();
    expect(s.total.runs).toBe(1);
    const all = (await call(`${period}&groupBy=task`, 'member')).json();
    expect(all.total.runs).toBe(1);
  });

  it('чужой и без модуля ai — 404; неверные параметры — 400', async () => {
    const q = `projectId=${w.projectId}&${period}&groupBy=task`;
    expect((await call(q, 'outsider')).statusCode).toBe(404);
    expect((await call(`projectId=${uuidv7()}&${period}&groupBy=task`, 'admin')).statusCode).toBe(
      404,
    );
    expect((await call(`${period}&groupBy=week`, 'admin')).statusCode).toBe(400);
    expect(
      (await call(`spaceId=${w.spaceId}&projectId=${w.projectId}&${period}&groupBy=day`, 'admin'))
        .statusCode,
    ).toBe(400);
    await raw(`update projects set modules = array_remove(modules, 'ai') where id = $1`, [
      w.projectId,
    ]);
    try {
      expect((await call(q, 'admin')).statusCode).toBe(404);
      expect((await call(`spaceId=${w.spaceId}&${period}&groupBy=task`, 'admin')).statusCode).toBe(
        404,
      );
      expect((await call(`${period}&groupBy=task`, 'admin')).json().total.runs).toBe(0);
    } finally {
      await raw(`update projects set modules = array_append(modules, 'ai') where id = $1`, [
        w.projectId,
      ]);
    }
  });
});
