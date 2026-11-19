// AIM-1: REST api/ai — runs of a task (visibility D7), stop, restart, monitor, switch, limits.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { MAX_RESTARTS } from '@planar/module-ai/api';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
const cookies: Record<string, string> = {};
let task: string;
let authored: string;

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
const run = async (taskId: string, state = 'done', restartOf: string | null = null) => {
  const id = uuidv7();
  await raw(
    `insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth, restart_of, log, input_tokens, output_tokens, cost)
     values ($1, $2, $3, 'checklist', $4, $1, 0, $5, 'the log', 10, 5, 0.5)`,
    [id, taskId, w.projectId, state, restartOf],
  );
  return id;
};
const stateOf = async (id: string) =>
  (await raw(`select state from ai_runs where id = $1`, [id]))[0]!.state;

beforeAll(async () => {
  w = await world(db);
  cookies.root = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    cookies[c] = await loginCookie(db, w[c].userId);
  await w.admin.ok('project.setModule', { projectId: w.projectId, moduleId: 'ai', enabled: true });
  // the task of the admin, assigned to the member; and the task the member made himself
  const a = taskArgs(w, { assignees: [{ id: uuidv7(), userId: w.member.userId }] });
  await w.admin.ok('task.create', a);
  task = a.id as string;
  const b = taskArgs(w, {});
  await w.member.ok('task.create', b);
  authored = b.id as string;
});
afterAll(async () => {
  await raw(`delete from ai_settings`);
});

describe('прогоны задачи: видимость (D7)', () => {
  it('исполнитель, автор, админ проекта и админ инстанса видят; чужой и несуществующая — одинаковый 404', async () => {
    const id = await run(task);
    for (const who of ['member', 'admin', 'root']) {
      const r = await call('GET', `tasks/${task}/runs`, who);
      expect(r.statusCode).toBe(200);
      expect(r.json().runs[0]).toMatchObject({ id, state: 'done', taskId: task, restartOf: null });
      expect(r.json().runs[0].log).toBeUndefined();
      expect((await call('GET', `runs/${id}`, who)).json().run.log).toBe('the log');
    }
    // the author without being assigned
    await run(authored);
    expect((await call('GET', `tasks/${authored}/runs`, 'member')).statusCode).toBe(200);
    for (const who of ['guest', 'outsider']) {
      expect((await call('GET', `tasks/${task}/runs`, who)).statusCode).toBe(404);
      expect((await call('GET', `runs/${id}`, who)).statusCode).toBe(404);
    }
    const missing = await call('GET', `tasks/${uuidv7()}/runs`, 'outsider');
    expect(missing.json()).toEqual((await call('GET', `tasks/${task}/runs`, 'outsider')).json());
    expect((await call('GET', `runs/${uuidv7()}`, 'member')).statusCode).toBe(404);
  });

  it('проект без модуля ai — прогоны не отдаются', async () => {
    await raw(`update projects set modules = array_remove(modules, 'ai') where id = $1`, [
      w.projectId,
    ]);
    try {
      expect((await call('GET', `tasks/${task}/runs`, 'admin')).statusCode).toBe(404);
    } finally {
      await raw(`update projects set modules = array_append(modules, 'ai') where id = $1`, [
        w.projectId,
      ]);
    }
  });
});

describe('остановка и перезапуск', () => {
  it('stop: running и waiting_human → cancelled; чужой — 404 и прогон цел; done не трогается', async () => {
    const a = await run(task, 'running');
    const b = await run(task, 'waiting_human');
    const c = await run(task, 'done');
    expect((await call('POST', `runs/${a}/stop`, 'outsider')).statusCode).toBe(404);
    expect(await stateOf(a)).toBe('running');
    for (const id of [a, b, c])
      expect((await call('POST', `runs/${id}/stop`, 'member')).statusCode).toBe(204);
    expect([await stateOf(a), await stateOf(b), await stateOf(c)]).toEqual([
      'cancelled',
      'cancelled',
      'done',
    ]);
  });

  it(`restart: цепочка не длиннее ${MAX_RESTARTS} (409), выключатель (409), чужой — 404`, async () => {
    const r0 = await run(task, 'failed');
    const r1 = await run(task, 'failed', r0);
    const r2 = await run(task, 'failed', r1);
    const r3 = await run(task, 'failed', r2);
    const solo = await run(task, 'failed');
    expect((await call('POST', `runs/${r0}/restart`, 'outsider')).statusCode).toBe(404);
    const ok = await call('POST', `runs/${solo}/restart`, 'member');
    expect(ok.statusCode).toBe(201);
    // the id of the NEW run (the queue creates the row with exactly this id and restart_of = r2)
    expect(ok.json().runId).toEqual(expect.any(String));
    expect(ok.json().runId).not.toBe(solo);
    // the limit counts the whole chain from its root, not only the ancestors
    for (const r of [r3, r0, r1])
      expect((await call('POST', `runs/${r}/restart`, 'member')).statusCode).toBe(409);
    expect((await call('PUT', 'settings', 'root', { enabled: false })).json()).toEqual({
      enabled: false,
    });
    expect((await call('POST', `runs/${solo}/restart`, 'member')).statusCode).toBe(409);
    await call('PUT', 'settings', 'root', { enabled: true });
    expect((await call('POST', `runs/${solo}/restart`, 'member')).statusCode).toBe(201);
  });

  it('restart прогона страницы: автор комментария — 201, чужой — 404, прогон без комментария — 409', async () => {
    const pageId = uuidv7();
    const commentId = uuidv7();
    await w.admin.ok('docs.page.create', {
      id: pageId,
      spaceId: w.spaceId,
      projectId: w.projectId,
      rank: 'a0',
      title: 'Страница',
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    await w.member.ok('docs.comment.create', {
      id: commentId,
      pageId,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    const pageRun = async (itemId: string | null) => {
      const id = uuidv7();
      await raw(
        `insert into ai_runs (id, page_id, project_id, kind, item_id, state, chain_id, chain_depth)
         values ($1, $2, $3, 'doc_comment', $4, 'failed', $1, 0)`,
        [id, pageId, w.projectId, itemId],
      );
      return id;
    };
    const r = await pageRun(commentId);
    expect((await call('POST', `runs/${r}/restart`, 'outsider')).statusCode).toBe(404);
    const ok = await call('POST', `runs/${r}/restart`, 'member');
    expect(ok.statusCode).toBe(201);
    expect(ok.json().runId).not.toBe(r);
    const noItem = await pageRun(null);
    expect((await call('POST', `runs/${noItem}/restart`, 'root')).statusCode).toBe(409);
  });

  it('stop и restart отменяют pending-пачки писем прогона', async () => {
    const batch = async (runId: string) => {
      const id = uuidv7();
      await raw(
        `insert into ai_email_batches (id, run_id, task_id, project_id, comment_id, state, emails)
         values ($1, $2, $3, $4, $5, 'pending', '[]')`,
        [id, runId, task, w.projectId, uuidv7()],
      );
      return id;
    };
    const st = async (id: string) =>
      (await raw(`select state from ai_email_batches where id = $1`, [id]))[0]!.state;
    const a = await run(task, 'running');
    const ba = await batch(a);
    expect((await call('POST', `runs/${a}/stop`, 'member')).statusCode).toBe(204);
    expect(await st(ba)).toBe('cancelled');
    const f = await run(task, 'failed');
    const bf = await batch(f);
    expect((await call('POST', `runs/${f}/restart`, 'member')).statusCode).toBe(201);
    expect(await st(bf)).toBe('cancelled');
  });

  it('чат-прогон без задачи: виден в мониторе, останавливает админ инстанса, чужой — 404', async () => {
    const id = uuidv7();
    await raw(
      `insert into ai_runs (id, kind, state, chain_id, chain_depth, item_id) values ($1, 'chat', 'running', $1, 0, $2)`,
      [id, uuidv7()],
    );
    const m = (await call('GET', 'monitor?limit=200', 'root')).json();
    expect(m.runs.map((r: { id: string }) => r.id)).toContain(id);
    expect((await call('POST', `runs/${id}/stop`, 'member')).statusCode).toBe(404);
    expect((await call('POST', `runs/${id}/stop`, 'root')).statusCode).toBe(204);
    expect(await stateOf(id)).toBe('cancelled');
  });

  it('limits: dailyTokens выше int4 — 400, не 500', async () => {
    const r = await call('PUT', `limits?projectId=${w.projectId}`, 'admin', {
      dailyTokens: 1e11,
      dailyCost: null,
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('монитор, выключатель, лимиты', () => {
  it('monitor — только админ инстанса; фильтр по состоянию, курсор, load и today', async () => {
    await raw(`delete from ai_runs`);
    const t = await run(task, 'running');
    await run(task, 'waiting_human');
    await run(task, 'done');
    expect((await call('GET', 'monitor', 'member')).statusCode).toBe(403);
    expect((await call('GET', 'monitor', 'admin')).statusCode).toBe(403);
    const m = (await call('GET', 'monitor?limit=2', 'root')).json();
    expect(m.runs).toHaveLength(2);
    expect(m.next).toBe(`${m.runs[1].createdAt}|${m.runs[1].id}`);
    expect(m.runs[0]).toMatchObject({ taskKey: expect.stringMatching(/-\d+$/), projectName: 'P' });
    expect(m).toMatchObject({
      load: { running: 1, waiting: 1 },
      today: { tokens: 45, cost: 1.5 },
      enabled: true,
      runner: false,
    });
    process.env.AI_RUNNER_URL = 'http://ai-runner:8080';
    try {
      expect((await call('GET', 'monitor', 'root')).json().runner).toBe(true);
    } finally {
      delete process.env.AI_RUNNER_URL;
    }
    const rest = (
      await call('GET', `monitor?limit=2&cursor=${encodeURIComponent(m.next)}`, 'root')
    ).json();
    expect(rest.runs).toHaveLength(1);
    expect(rest.next).toBeNull();
    const only = (await call('GET', 'monitor?state=running', 'root')).json();
    expect(only.runs.map((r: { id: string }) => r.id)).toEqual([t]);
    expect((await call('GET', 'monitor?state=nope', 'root')).statusCode).toBe(400);
    expect((await call('PUT', 'settings', 'member', { enabled: false })).statusCode).toBe(403);
  });

  it('limits: админ проекта читает и пишет; effective — свой, иначе env; участник — 403', async () => {
    const q = `limits?projectId=${w.projectId}`;
    expect((await call('GET', q, 'member')).statusCode).toBe(403);
    expect((await call('PUT', q, 'member', { dailyTokens: 1, dailyCost: null })).statusCode).toBe(
      403,
    );
    const put = await call('PUT', q, 'admin', { dailyTokens: 5000, dailyCost: null });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      dailyTokens: 5000,
      dailyCost: null,
      autopilot: false,
      dailyTasks: null,
      effective: { dailyTokens: 5000, dailyCost: null, dailyTasks: 50 },
      usedToday: { tokens: 45, cost: 1.5, tasks: 0 },
    });
    // PLNRAPP-408: the autopilot and its guard; a PUT without them keeps them
    const ap = await call('PUT', q, 'admin', {
      dailyTokens: 5000,
      dailyCost: null,
      dailyTasks: 3,
      autopilot: true,
    });
    expect(ap.json()).toMatchObject({ autopilot: true, dailyTasks: 3 });
    const kept = await call('PUT', q, 'admin', { dailyTokens: 5000, dailyCost: null });
    expect(kept.json()).toMatchObject({ autopilot: true, effective: { dailyTasks: 3 } });
    expect((await call('PUT', q, 'admin', { dailyTokens: -1, dailyCost: null })).statusCode).toBe(
      400,
    );
    process.env.PLANAR_AI_DAILY_COST = '7';
    try {
      expect((await call('GET', q, 'admin')).json().effective).toEqual({
        dailyTokens: 5000,
        dailyCost: 7,
        dailyTasks: 3,
      });
    } finally {
      delete process.env.PLANAR_AI_DAILY_COST;
    }
  });
});

// runs a fresh set of runs: the last, so the tests above keep theirs
describe('монитор по проекту', () => {
  it('monitor?projectId (PLNRAPP-567): только задачи ИИ по задачам проекта; админ проекта и воркспейса — да, остальные — 403', async () => {
    await raw(`delete from ai_runs`);
    const mine = await run(task, 'running');
    // another project of another world, and a chat run bound to the project but without a task
    const w2 = await world(db);
    await w2.admin.ok('project.setModule', {
      projectId: w2.projectId,
      moduleId: 'ai',
      enabled: true,
    });
    const t2 = taskArgs(w2, {});
    await w2.admin.ok('task.create', t2);
    const other = uuidv7();
    await raw(
      `insert into ai_runs (id, task_id, project_id, kind, state, chain_id, chain_depth, input_tokens, output_tokens, cost)
       values ($1, $2, $3, 'checklist', 'running', $1, 0, 100, 0, 7)`,
      [other, t2.id, w2.projectId],
    );
    const chat = uuidv7();
    await raw(
      `insert into ai_runs (id, project_id, kind, state, chain_id, chain_depth, item_id) values ($1, $2, 'chat', 'running', $1, 0, $3)`,
      [chat, w.projectId, uuidv7()],
    );
    const q = `monitor?projectId=${w.projectId}`;
    for (const who of ['admin', 'root']) {
      const r = await call('GET', q, who);
      expect(r.statusCode).toBe(200);
      const m = r.json();
      expect(m.runs.map((x: { id: string }) => x.id)).toEqual([mine]);
      expect(m.load).toEqual({ running: 1, waiting: 0 });
      expect(m.today).toEqual({ tokens: 15, cost: 0.5 });
    }
    // without a project — the whole workspace, a workspace admin only
    const all = (await call('GET', 'monitor', 'root')).json();
    expect(all.runs.map((x: { id: string }) => x.id).sort()).toEqual([mine, other, chat].sort());
    for (const who of ['member', 'guest', 'outsider'])
      expect((await call('GET', q, who)).statusCode).toBe(403);
    // an admin of another project — 403 too
    const c2 = await loginCookie(db, w2.admin.userId);
    const r2 = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: `/api/ai/${q}`, headers: { cookie: c2, origin: ORIGIN } });
    expect(r2.statusCode).toBe(403);
    expect((await call('GET', `monitor?projectId=${uuidv7()}`, 'root')).statusCode).toBe(404);
    // the module off in the project — 403 even for its admin
    await raw(`update projects set modules = array_remove(modules, 'ai') where id = $1`, [
      w.projectId,
    ]);
    try {
      expect((await call('GET', q, 'admin')).statusCode).toBe(403);
    } finally {
      await raw(`update projects set modules = array_append(modules, 'ai') where id = $1`, [
        w.projectId,
      ]);
    }
  });
});
