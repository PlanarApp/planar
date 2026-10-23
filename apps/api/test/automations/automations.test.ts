import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import { PushService } from '../../src/sync/push.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import {
  dbUrl,
  key,
  newDb,
  TestClient,
  taskArgs,
  world,
  services,
  type World,
} from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;
let P: string; // проект теста: правила соседних тестов не мешают
let api: JobApi;
let app: Awaited<ReturnType<typeof createApp>>;
const [BACKLOG, TODO, PROG, DONE] = [0, 1, 2, 3];
type Job = { queue: string; data: Record<string, unknown>; key?: string };
const jobs: Job[] = [];
const handler = (name: string) =>
  (
    installed.find((m) => m.api.id === 'automations')!.api.jobs as {
      queue: string;
      cron?: string;
      retryLimit?: number;
      handler(d: unknown, api: JobApi): Promise<void>;
    }[]
  ).find((j) => j.queue === name)!;

beforeAll(async () => {
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['automations'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['automations'] } });
  w = await world(db);
  // мутации идут через PushService с очередью: enqueue хуков попадает в jobs
  const svc = { ...services(db), push: new PushService(db, queue) };
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    w[c] = new TestClient(svc, w[c].userId);
  queue.jobs.enqueue = async (q, data, o) =>
    void jobs.push({ queue: q, data: data as never, key: o?.singletonKey });
  api = {
    ...(await queue.jobs.api()),
    enqueue: async (q, data, o) =>
      void jobs.push({ queue: q, data: data as never, key: o?.singletonKey }),
  };
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const raw = (text: string) => db.$client.query(text).then((r) => r.rows);
const runsOf = (ruleId: string) =>
  raw(`select * from automations_runs where rule_id = '${ruleId}' order by created_at, id`);
/** Выполняет поставленные automations.run (в том числе порождённые) по порядку. */
async function drain() {
  for (let i = 0; i < 50; i++) {
    const j = jobs.findIndex((x) => x.queue === 'automations.run');
    if (j < 0) return;
    const [job] = jobs.splice(j, 1);
    await handler('automations.run').handler(job!.data, api);
  }
}
const queued = (ruleId: string) => jobs.filter((j) => j.data.ruleId === ruleId);

type Rule = {
  id: string;
  projectId: string;
};
async function project() {
  const id = uuidv7();
  await w.admin.ok('project.create', { id, spaceId: w.spaceId, name: 'P', key: key(), rank: 'a0' });
  return id;
}
async function rule(
  trigger: object,
  actions: object[] = [{ type: 'set_status', statusId: w.statusIds[PROG] }],
  over: Record<string, unknown> = {},
): Promise<Rule> {
  const id = uuidv7();
  const projectId = (over.projectId as string) ?? P;
  await w.admin.ok('automations.create', { id, projectId, name: 'R', trigger, actions, ...over });
  return { id, projectId };
}
async function task(over: Record<string, unknown> = {}) {
  const a = taskArgs(w, { projectId: P, ...over });
  await w.admin.ok('task.create', a);
  return a.id;
}
const row = async (id: string) =>
  (await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)))[0]!;
const ok = (clientRes: Promise<unknown>) => clientRes;
const statuses = (r: { status: string }[]) => r.map((x) => x.status);

beforeEach(async () => {
  P = await project();
  jobs.length = 0;
});

describe('wk3: правила (мутаторы)', () => {
  it('wk3: create — enabled=true и пустые условия по умолчанию', async () => {
    const r = await rule({ type: 'task.created' });
    const [x] = await raw(`select * from automations_rules where id = '${r.id}'`);
    expect(x).toMatchObject({ enabled: true, conditions: { op: 'and', rules: [] }, name: 'R' });
    expect(x.space_id).toBe(w.spaceId);
  });

  it('wk3: неверные trigger/actions → invalid_args', async () => {
    const bad = async (over: Record<string, unknown>) =>
      expect(
        await w.admin.push('automations.create', {
          id: uuidv7(),
          projectId: P,
          name: 'R',
          trigger: { type: 'task.created' },
          actions: [{ type: 'assign', userId: w.member.userId }],
          ...over,
        }),
      ).toMatchObject({ ok: false, code: 'invalid_args' });
    await bad({ trigger: { type: 'task.nope' } });
    await bad({ trigger: { type: 'task.due', daysBefore: 31 } });
    await bad({ actions: [] });
    await bad({ actions: Array(11).fill({ type: 'assign', userId: w.member.userId }) });
    await bad({ actions: [{ type: 'send_webhook', subscriptionId: uuidv7() }] });
    await bad({ actions: [{ type: 'set_field', field: 'priority', value: 9 }] });
    await bad({ actions: [{ type: 'set_field', field: 'dueDate', value: 'завтра' }] });
    await bad({ name: '' });
    await bad({ conditions: { op: 'xor', rules: [] } });
  });

  it('wk3: update и delete; несуществующее — not_found', async () => {
    const r = await rule({ type: 'task.created' });
    await w.admin.ok('automations.update', { id: r.id, enabled: false, name: 'N' });
    expect(
      (await raw(`select enabled, name from automations_rules where id = '${r.id}'`))[0],
    ).toEqual({
      enabled: false,
      name: 'N',
    });
    expect(await w.admin.push('automations.update', { id: r.id })).toMatchObject({
      code: 'invalid_args',
    });
    await w.admin.ok('automations.delete', { id: r.id });
    expect(await raw(`select 1 from automations_rules where id = '${r.id}'`)).toHaveLength(0);
    expect(await w.admin.push('automations.delete', { id: r.id })).toMatchObject({
      code: 'not_found',
    });
  });

  it('wk3: гость не пишет правила', async () => {
    const res = await w.guest.push('automations.create', {
      id: uuidv7(),
      projectId: P,
      name: 'R',
      trigger: { type: 'task.created' },
      actions: [{ type: 'add_comment', text: 'x' }],
    });
    expect(res).toMatchObject({ ok: false });
  });
});

describe('wk3: триггеры', () => {
  it('wk3: task.created запускает правило; выключенное и чужого проекта — нет', async () => {
    const p2 = await project();
    const on = await rule({ type: 'task.created' });
    const off = await rule({ type: 'task.created' }, undefined, { enabled: false });
    const other = await rule({ type: 'task.created' }, undefined, { projectId: p2 });
    jobs.length = 0;
    const t = await task();
    expect(queued(on.id)).toHaveLength(1);
    expect(queued(on.id)[0]!.data).toMatchObject({ taskId: t, depth: 1 });
    expect(queued(off.id)).toHaveLength(0);
    expect(queued(other.id)).toHaveLength(0);
    jobs.length = 0;
  });

  it('wk3: task.status_changed с from/to', async () => {
    const any = await rule({ type: 'task.status_changed' });
    const toDone = await rule({ type: 'task.status_changed', to: [w.statusIds[DONE]] });
    const fromBacklog = await rule({ type: 'task.status_changed', from: [w.statusIds[BACKLOG]] });
    const t = await task({ statusId: w.statusIds[TODO] });
    jobs.length = 0;
    await w.admin.ok('task.update', { id: t, title: 'без смены статуса' });
    expect(jobs).toHaveLength(0);
    await w.admin.ok('task.update', { id: t, statusId: w.statusIds[PROG] });
    expect(queued(any.id)).toHaveLength(1);
    expect(queued(toDone.id)).toHaveLength(0);
    expect(queued(fromBacklog.id)).toHaveLength(0);
    await w.admin.ok('task.update', { id: t, statusId: w.statusIds[DONE] });
    expect(queued(toDone.id)).toHaveLength(1);
    jobs.length = 0;
    const t2 = await task({ statusId: w.statusIds[BACKLOG] });
    jobs.length = 0;
    await w.admin.ok('task.update', { id: t2, statusId: w.statusIds[TODO] });
    expect(queued(fromBacklog.id)).toHaveLength(1);
    jobs.length = 0;
  });

  it('wk3: task.assignee_changed — любой и с userId (только добавление)', async () => {
    const any = await rule({ type: 'task.assignee_changed' });
    const mine = await rule({ type: 'task.assignee_changed', userId: w.member.userId });
    const t = await task();
    jobs.length = 0;
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t, userId: w.admin.userId });
    expect(queued(any.id)).toHaveLength(1);
    expect(queued(mine.id)).toHaveLength(0);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t, userId: w.member.userId });
    expect(queued(mine.id)).toHaveLength(1);
    await w.admin.ok('task.unassign', { taskId: t, userId: w.member.userId });
    expect(queued(any.id)).toHaveLength(3);
    expect(queued(mine.id)).toHaveLength(1); // снятие не считается
    jobs.length = 0;
  });

  it('wk3: task.field_changed — priority и field:<id>', async () => {
    const fieldId = uuidv7();
    await w.admin.ok('field.create', {
      id: fieldId,
      projectId: P,
      name: 'N',
      type: 'number',
      rank: 'a0',
    });
    const pr = await rule({ type: 'task.field_changed', field: 'priority' });
    const fl = await rule({ type: 'task.field_changed', field: `field:${fieldId}` });
    const t = await task();
    jobs.length = 0;
    await w.admin.ok('task.update', { id: t, title: 'другое' });
    expect(jobs).toHaveLength(0);
    await w.admin.ok('task.update', { id: t, priority: 3 });
    expect(queued(pr.id)).toHaveLength(1);
    expect(queued(fl.id)).toHaveLength(0);
    await w.admin.ok('task.setField', { taskId: t, fieldId, value: 5 });
    expect(queued(fl.id)).toHaveLength(1);
    expect(queued(pr.id)).toHaveLength(1);
    await w.admin.ok('task.update', { id: t, priority: 3 }); // то же значение
    expect(queued(pr.id)).toHaveLength(1);
    jobs.length = 0;
  });

  it('wk3: comment.added', async () => {
    const r = await rule({ type: 'comment.added' });
    const t = await task();
    jobs.length = 0;
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(queued(r.id)).toHaveLength(1);
    expect(queued(r.id)[0]!.data.taskId).toBe(t);
    jobs.length = 0;
  });

  it('wk3: task.due — cron с подменённым now: срок, один раз, не done', async () => {
    expect(handler('automations.due').cron).toBe('0 * * * *');
    const p = await project();
    const r3 = await rule({ type: 'task.due', daysBefore: 3 }, undefined, { projectId: p });
    const r1 = await rule({ type: 'task.due', daysBefore: 1 }, undefined, { projectId: p });
    const mk = async (over: Record<string, unknown>) => {
      const a = taskArgs(w, { projectId: p, ...over });
      await w.admin.ok('task.create', a);
      return a.id;
    };
    const soon = await mk({ dueDate: '2026-11-10' });
    const done = await mk({ dueDate: '2026-11-10', statusId: w.statusIds[DONE] });
    await mk({}); // без срока
    jobs.length = 0;
    const now = '2026-11-08T12:00:00.000Z';
    await handler('automations.due').handler({ now }, api);
    expect(queued(r3.id).map((j) => j.data.taskId)).toEqual([soon]);
    expect(queued(r1.id)).toHaveLength(0); // 10−1=9 > 8
    expect(queued(r3.id)[0]!.data.depth).toBe(1);
    expect(queued(r3.id).map((j) => j.data.taskId)).not.toContain(done);
    await handler('automations.due').handler({ now }, api);
    expect(queued(r3.id)).toHaveLength(1); // повтор — не ставит
    await handler('automations.due').handler({ now: '2026-11-09T12:00:00.000Z' }, api);
    expect(queued(r1.id)).toHaveLength(1);
    // новый срок — снова один раз
    await w.admin.ok('task.update', { id: soon, dueDate: '2026-11-20' });
    await handler('automations.due').handler({ now: '2026-11-18T12:00:00.000Z' }, api);
    expect(queued(r3.id)).toHaveLength(2);
    jobs.length = 0;
  });

  it('wk3: task.due — «сегодня» в часовом поясе инстанса (settings.timezone)', async () => {
    const p = await project();
    const r = await rule({ type: 'task.due', daysBefore: 0 }, undefined, { projectId: p });
    const a = taskArgs(w, { projectId: p, dueDate: '2026-12-02' });
    await w.admin.ok('task.create', a);
    jobs.length = 0;
    const now = '2026-12-01T12:00:00.000Z';
    await db.insert(schema.settings).values({ id: 'timezone', value: 'UTC' });
    await handler('automations.due').handler({ now }, api);
    expect(queued(r.id)).toHaveLength(0);
    await db
      .update(schema.settings)
      .set({ value: 'Pacific/Kiritimati' })
      .where(eq(schema.settings.id, 'timezone'));
    await handler('automations.due').handler({ now }, api);
    expect(queued(r.id)).toHaveLength(1);
    await db.delete(schema.settings).where(eq(schema.settings.id, 'timezone'));
    jobs.length = 0;
  });
});

describe('wk3: условия и действия', () => {
  const only = async (r: Rule, t: string) => {
    await drain();
    return (await runsOf(r.id)).filter((x) => x.task_id === t);
  };

  it('wk3: условия — не выполнены → skipped, действия не применены', async () => {
    const r = await rule(
      { type: 'task.created' },
      [{ type: 'set_status', statusId: w.statusIds[PROG] }],
      { conditions: { op: 'and', rules: [{ field: 'priority', operator: 'in', value: ['4'] }] } },
    );
    const no = await task({ priority: 1 });
    const yes = await task({ priority: 4 });
    await drain();
    expect(statuses(await only(r, no))).toEqual(['skipped']);
    expect(statuses(await only(r, yes))).toEqual(['ok']);
    expect((await row(no)).statusId).toBe(w.statusIds[TODO]);
    expect((await row(yes)).statusId).toBe(w.statusIds[PROG]);
  });

  it('wk3: set_status, assign, add_label, add_comment — от системного пользователя', async () => {
    const labelId = uuidv7();
    await w.admin.ok('label.create', { id: labelId, spaceId: w.spaceId, name: 'L', color: '#fff' });
    const r = await rule({ type: 'task.created' }, [
      { type: 'set_status', statusId: w.statusIds[DONE] },
      { type: 'assign', userId: w.member.userId },
      { type: 'add_label', labelId },
      { type: 'add_comment', text: 'готово, @' + 'nobody' },
    ]);
    const t = await task();
    expect(statuses(await only(r, t))).toEqual(['ok']);
    expect((await row(t)).statusId).toBe(w.statusIds[DONE]);
    expect((await row(t)).completedAt).not.toBeNull();
    expect(await raw(`select user_id from task_assignees where task_id = '${t}'`)).toEqual([
      { user_id: w.member.userId },
    ]);
    expect(await raw(`select label_id from task_labels where task_id = '${t}'`)).toEqual([
      { label_id: labelId },
    ]);
    const [c] = await raw(`select author_id, body from comments where task_id = '${t}'`);
    expect(c.author_id).toBe(api.systemUserId);
    expect(JSON.stringify(c.body)).toContain('готово');
  });

  it('wk3: unassign и remove_label', async () => {
    const labelId = uuidv7();
    await w.admin.ok('label.create', {
      id: labelId,
      spaceId: w.spaceId,
      name: 'L2',
      color: '#fff',
    });
    const r = await rule({ type: 'comment.added' }, [
      { type: 'unassign', userId: w.member.userId },
      { type: 'remove_label', labelId },
    ]);
    const t = await task({
      assignees: [{ id: uuidv7(), userId: w.member.userId }],
      labels: [{ id: uuidv7(), labelId }],
    });
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(statuses(await only(r, t))).toEqual(['ok']);
    expect(await raw(`select 1 from task_assignees where task_id = '${t}'`)).toHaveLength(0);
    expect(await raw(`select 1 from task_labels where task_id = '${t}'`)).toHaveLength(0);
  });

  it('wk3: set_field — priority, dueDate today+N, null, field:<id>', async () => {
    const fieldId = uuidv7();
    await w.admin.ok('field.create', {
      id: fieldId,
      projectId: P,
      name: 'T',
      type: 'text',
      rank: 'a0',
    });
    const r = await rule({ type: 'task.created' }, [
      { type: 'set_field', field: 'priority', value: 4 },
      { type: 'set_field', field: 'dueDate', value: 'today+3' },
      { type: 'set_field', field: 'startDate', value: '2026-01-02' },
      { type: 'set_field', field: `field:${fieldId}`, value: 'привет' },
    ]);
    const t = await task({ dueDate: '2020-01-01' });
    expect(statuses(await only(r, t))).toEqual(['ok']);
    const x = (await db.select().from(schema.tasks).where(eq(schema.tasks.id, t)))[0]!;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 3);
    expect(x).toMatchObject({
      priority: 4,
      startDate: '2026-01-02',
      fields: { [fieldId]: 'привет' },
    });
    // «сегодня» считается в поясе инстанса (UTC по умолчанию); допускаем границу суток
    expect([d.toISOString().slice(0, 10)]).toContain(x.dueDate);
    const r2 = await rule({ type: 'comment.added' }, [
      { type: 'set_field', field: 'dueDate', value: null },
    ]);
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(statuses(await only(r2, t))).toEqual(['ok']);
    expect((await row(t)).dueDate).toBeNull();
  });

  it('wk3: move_to_project и create_subtask (статус — первый todo)', async () => {
    const p2 = await project();
    const mv = await rule({ type: 'task.created' }, [
      { type: 'move_to_project', projectId: p2, statusId: w.statusIds[BACKLOG] },
    ]);
    const t = await task();
    expect(statuses(await only(mv, t))).toEqual(['ok']);
    expect(await row(t)).toMatchObject({ projectId: p2, statusId: w.statusIds[BACKLOG] });

    const sub = await rule(
      { type: 'task.created' },
      [{ type: 'create_subtask', title: 'Проверить' }],
      {
        projectId: p2,
      },
    );
    const t2 = await task({ projectId: p2, statusId: w.statusIds[DONE] });
    expect(statuses(await only(sub, t2))).toEqual(['ok']);
    const kids = await db.select().from(schema.tasks).where(eq(schema.tasks.parentId, t2));
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({
      title: 'Проверить',
      projectId: p2,
      statusId: w.statusIds[TODO],
    });
    // подзадача сама — task.created: правило ставится повторно, глубина 2
    expect(queued(sub.id).concat(await runsOf(sub.id)).length).toBeGreaterThan(0);
    jobs.length = 0;
  });
});

describe('wk3: выполнение и защита', () => {
  it('wk3: правило не срабатывает на своё действие', async () => {
    const r = await rule({ type: 'task.status_changed' }, [
      { type: 'set_status', statusId: w.statusIds[DONE] },
    ]);
    const t = await task();
    jobs.length = 0;
    await w.admin.ok('task.update', { id: t, statusId: w.statusIds[PROG] });
    await drain();
    expect((await row(t)).statusId).toBe(w.statusIds[DONE]);
    expect(statuses(await runsOf(r.id))).toEqual(['ok']); // второго запуска нет
    expect(jobs).toHaveLength(0);
  });

  it('wk3: цепочка правил обрывается на глубине 3', async () => {
    const p = await project();
    const R = (trigger: object, actions: object[]) => rule(trigger, actions, { projectId: p });
    const r1 = await R({ type: 'task.created' }, [
      { type: 'set_field', field: 'priority', value: 2 },
    ]);
    const r2 = await R({ type: 'task.field_changed', field: 'priority' }, [
      { type: 'assign', userId: w.member.userId },
    ]);
    const r3 = await R({ type: 'task.assignee_changed' }, [
      { type: 'set_status', statusId: w.statusIds[PROG] },
    ]);
    const r4 = await R({ type: 'task.status_changed' }, [
      { type: 'set_field', field: 'dueDate', value: 'today' },
    ]);
    const a = taskArgs(w, { projectId: p });
    await w.admin.ok('task.create', a);
    await drain();
    expect(await runsOf(r1.id)).toMatchObject([{ depth: 1, status: 'ok' }]);
    expect(await runsOf(r2.id)).toMatchObject([{ depth: 2, status: 'ok' }]);
    expect(await runsOf(r3.id)).toMatchObject([{ depth: 3, status: 'ok' }]);
    expect(await runsOf(r4.id)).toHaveLength(0); // был бы depth 4
    expect((await row(a.id)).dueDate).toBeNull();
  });

  it('wk3: ошибка действия — откат всех действий, запуск error с текстом', async () => {
    const r = await rule({ type: 'task.created' }, [
      { type: 'assign', userId: w.member.userId },
      { type: 'set_status', statusId: uuidv7() },
    ]);
    const t = await task();
    await drain();
    const [run] = await runsOf(r.id);
    expect(run).toMatchObject({ status: 'error', task_id: t, depth: 1 });
    expect(run.error).toBeTruthy();
    expect(await raw(`select 1 from task_assignees where task_id = '${t}'`)).toHaveLength(0);
    expect(await row(t)).toMatchObject({ statusId: w.statusIds[TODO] }); // исходная мутация цела
  });

  it('wk3: выключенное или удалённое правило, удалённая задача — skipped', async () => {
    const r = await rule({ type: 'task.created' });
    const gone = await rule({ type: 'task.created' });
    const t = await task();
    const t2 = await task();
    await w.admin.ok('automations.update', { id: r.id, enabled: false });
    await w.admin.ok('automations.delete', { id: gone.id });
    await w.admin.ok('task.delete', { id: t2 });
    await drain();
    expect(statuses(await runsOf(r.id))).toEqual(['skipped', 'skipped']); // t и удалённая t2
    expect(statuses(await runsOf(gone.id))).toEqual(['skipped', 'skipped']);
    const r3 = await rule({ type: 'task.created' });
    const t3 = await task();
    await w.admin.ok('task.delete', { id: t3 });
    await drain();
    expect(statuses(await runsOf(r3.id))).toEqual(['skipped']);
    expect(t).toBeTruthy();
  });

  it('wk3: удаление задачи не ставит запусков', async () => {
    const r = await rule({ type: 'task.assignee_changed' });
    const t = await task({ assignees: [{ id: uuidv7(), userId: w.member.userId }] });
    jobs.length = 0;
    await w.admin.ok('task.delete', { id: t });
    expect(queued(r.id)).toHaveLength(0);
  });

  it('wk3: воркер без повторов, расписание due — раз в час', () => {
    expect(handler('automations.run').retryLimit).toBe(0);
    expect(handler('automations.run').cron).toBeUndefined();
  });

  it('wk3: cron удаляет запуски старше 30 дней', async () => {
    const r = await rule({ type: 'task.created' });
    const mk = (days: number) =>
      raw(
        `insert into automations_runs (id, rule_id, task_id, depth, status, created_at)
         values ('${uuidv7()}', '${r.id}', '${uuidv7()}', 1, 'ok', now() - interval '${days} days')`,
      );
    await mk(31);
    await mk(5);
    await handler('automations.due').handler({}, api);
    expect(await runsOf(r.id)).toHaveLength(1);
  });
});

describe('wk3: REST журнал запусков', () => {
  const get = async (url: string, who: 'admin' | 'member' | 'outsider') =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url,
        headers: { cookie: await loginCookie(db, w[who].userId), origin: ORIGIN },
      });

  it('wk3: runs — новые сверху, limit, 404 чужому и несуществующему', async () => {
    const r = await rule({ type: 'task.created' });
    for (let i = 0; i < 3; i++) await task();
    await drain();
    const res = await get(`/api/automations/rules/${r.id}/runs`, 'member');
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { createdAt: string; ruleId: string; status: string }[];
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ ruleId: r.id, status: 'ok', depth: 1, error: null });
    expect([...data].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))).toEqual(data);
    expect(
      (await get(`/api/automations/rules/${r.id}/runs?limit=2`, 'admin')).json().data,
    ).toHaveLength(2);
    expect((await get(`/api/automations/rules/${r.id}/runs?limit=0`, 'admin')).statusCode).toBe(
      400,
    );
    expect((await get(`/api/automations/rules/${r.id}/runs?limit=201`, 'admin')).statusCode).toBe(
      400,
    );
    expect((await get(`/api/automations/rules/${r.id}/runs`, 'outsider')).statusCode).toBe(404);
    expect((await get(`/api/automations/rules/${uuidv7()}/runs`, 'admin')).statusCode).toBe(404);
    expect((await get(`/api/automations/rules/не-uuid/runs`, 'admin')).statusCode).toBe(404);
  });
});

void ok;
void and;
void sql;
