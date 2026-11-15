// PLNRAPP-202: GET api/ai/activity/* — the indicator of the AI's work on a task and in a chat channel.
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
const cookies: Record<string, string> = {};
let task: string;

const call = (url: string, who: string) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'GET',
      url: `/api/ai/${url}`,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const raw = (text: string, values: unknown[] = []) =>
  db.$client.query(text, values).then((r) => r.rows as Record<string, unknown>[]);
/** a run; `ago` — hours since its creation and last change */
const run = async (
  o: {
    taskId?: string | null;
    channelId?: string | null;
    kind?: string;
    itemId?: string | null;
    state?: string;
    ago?: number;
    agent?: boolean;
  } = {},
) => {
  const id = uuidv7();
  await raw(
    `insert into ai_runs (id, task_id, project_id, channel_id, kind, item_id, state, chain_id, chain_depth,
       agent_secret_hash, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $1, 0, $8, now() - make_interval(hours => $9::int),
       now() - make_interval(hours => $9::int))`,
    [
      id,
      o.taskId === undefined ? task : o.taskId,
      o.channelId ? null : w.projectId,
      o.channelId ?? null,
      o.kind ?? 'comment',
      o.itemId === undefined ? uuidv7() : o.itemId,
      o.state ?? 'running',
      o.agent ? 'hash' : null,
      o.ago ?? 0,
    ],
  );
  return id;
};
const ids = (r: { json(): { activity: { id: string }[] } }) =>
  r
    .json()
    .activity.map((a) => a.id)
    .sort();

beforeAll(async () => {
  w = await world(db);
  for (const c of ['admin', 'member', 'outsider'] as const)
    cookies[c] = await loginCookie(db, w[c].userId);
  await w.admin.ok('project.setModule', { projectId: w.projectId, moduleId: 'ai', enabled: true });
  // the admin's task without assignees: the member sees the task, but not its runs (D7) — the indicator he does
  const a = taskArgs(w, {});
  await w.admin.ok('task.create', a);
  task = a.id as string;
});

describe('activity задачи', () => {
  it('идущие, ждущие человека и свежая неповторённая ошибка; завершённые и старые — нет', async () => {
    const running = await run({ kind: 'checklist', agent: true });
    const waiting = await run({ state: 'waiting_human' });
    const failed = await run({ state: 'failed', ago: 2 });
    await run({ state: 'done' });
    await run({ state: 'cancelled' });
    await run({ state: 'failed', ago: 48 }); // older than a day
    // the failure of an item repeated after: not shown
    const item = uuidv7();
    await run({ state: 'failed', itemId: item, ago: 3 });
    await run({ state: 'done', itemId: item, ago: 1 });
    // the action of the task itself (no item) failed
    const action = await run({ kind: 'checklist', state: 'failed', itemId: null, ago: 1 });

    const r = await call(`activity/tasks/${task}`, 'member');
    expect(r.statusCode).toBe(200);
    expect(ids(r)).toEqual([running, waiting, failed, action].sort());
    const byId = new Map(
      (r.json().activity as Record<string, unknown>[]).map((a) => [a.id as string, a]),
    );
    expect(byId.get(running)).toMatchObject({ kind: 'checklist', state: 'running', agent: true });
    expect(byId.get(waiting)).toMatchObject({ state: 'waiting_human', agent: false });
    expect(byId.get(action)).toMatchObject({ itemId: null, state: 'failed' });
    expect(byId.get(running)!.startedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(byId.get(running)!).not.toHaveProperty('log');
    expect((await call(`activity/tasks/${task}`, 'admin')).statusCode).toBe(200);
  });

  it('не видящему задачу и несуществующей — одинаковый 404; без модуля ai — 404', async () => {
    const r = await call(`activity/tasks/${task}`, 'outsider');
    expect(r.statusCode).toBe(404);
    expect((await call(`activity/tasks/${uuidv7()}`, 'member')).json()).toEqual(r.json());
    expect((await call('activity/tasks/not-a-uuid', 'member')).statusCode).toBe(404);
    await raw(`update projects set modules = array_remove(modules, 'ai') where id = $1`, [
      w.projectId,
    ]);
    try {
      expect((await call(`activity/tasks/${task}`, 'admin')).statusCode).toBe(404);
    } finally {
      await raw(`update projects set modules = array_append(modules, 'ai') where id = $1`, [
        w.projectId,
      ]);
    }
  });
});

describe('activity канала', () => {
  it('«ИИ печатает…»: идущие прогоны чата — участникам пространства канала, чужому — 404', async () => {
    const ch = uuidv7();
    await raw(
      `insert into chat_channels (id, space_id, kind, name, created_by, last_seq, created_at, updated_at)
       values ($1, $2, 'channel', 'general', $3, 0, now(), now())`,
      [ch, w.spaceId, w.admin.userId],
    );
    const typing = await run({ taskId: null, channelId: ch, kind: 'chat' });
    await run({ taskId: null, channelId: ch, kind: 'chat', state: 'done' });
    await run({ taskId: null, channelId: ch, kind: 'chat', state: 'waiting_human' });
    await run({ taskId: null, channelId: uuidv7(), kind: 'chat' }); // another channel

    const r = await call(`activity/channels/${ch}`, 'member');
    expect(r.statusCode).toBe(200);
    expect(ids(r)).toEqual([typing]);
    expect(r.json().activity[0]).toMatchObject({ kind: 'chat', state: 'running' });
    expect((await call(`activity/channels/${ch}`, 'outsider')).statusCode).toBe(404);
    expect((await call(`activity/channels/${uuidv7()}`, 'member')).statusCode).toBe(404);
  });
});
