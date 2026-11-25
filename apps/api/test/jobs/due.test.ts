// PLNRAPP-161: at 9:xx in the profile's zone — notifications about today's due date / start date to the assignees.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { dueFireAt, remindDue, remindDueTime } from '../../src/jobs/due.js';
import { ensureSystemUser } from '../../src/users/system.js';
import { newDb, taskArgs, world, type World } from '../sync/helpers.js';

const db = newDb();
let w: World;
let sys: string;

beforeAll(async () => {
  w = await world(db);
  sys = await ensureSystemUser(db);
});
afterAll(() => db.$client.end());

const raw = (q: string, a: unknown[] = []) => db.$client.query(q, a).then((r) => r.rows);
// statusIds: [backlog, todo, in_progress, done, cancelled]
const task = async (over: Record<string, unknown>) => {
  const t = taskArgs(w, { assignees: [{ id: uuidv7(), userId: w.member.userId }], ...over });
  await w.admin.ok('task.create', t);
  return t.id;
};

describe('due reminders', () => {
  it('9:10 в Asia/Almaty: срок и начало сегодня — по уведомлению; закрытые, архивные, завтрашние — нет; повтор — нет', async () => {
    await raw(`update users set timezone = 'Asia/Almaty' where id = $1`, [w.member.userId]);
    const nineLocal = new Date('2026-11-12T04:10:00Z'); // UTC+5 → 09:10, 12 Nov
    const due = await task({ dueDate: '2026-11-12' });
    const start = await task({ startDate: '2026-11-12' });
    await task({ dueDate: '2026-11-12', statusId: w.statusIds[3] }); // done
    await task({ dueDate: '2026-11-13' });
    const archived = await task({ dueDate: '2026-11-12' });
    await w.admin.ok('task.archive', { id: archived });
    // an assignee of the same task in UTC: 04:10 there — not yet
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: due, userId: w.admin.userId });

    expect(await remindDue(db, sys, new Date('2026-11-12T03:55:00Z'))).toEqual([]); // 08:55
    const ids = await remindDue(db, sys, nineLocal);
    const rows = await raw(
      `select user_id, task_id, kind, actor_id from notifications where id = any($1) order by kind`,
      [ids],
    );
    expect(rows).toEqual([
      { user_id: w.member.userId, task_id: due, kind: 'due_today', actor_id: sys },
      { user_id: w.member.userId, task_id: start, kind: 'start_today', actor_id: sys },
    ]);
    expect(await remindDue(db, sys, new Date('2026-11-12T04:25:00Z'))).toEqual([]);
  });
});

describe('dueFireAt', () => {
  it('пояс и N минут', () => {
    const a = dueFireAt('2026-11-12', '09:00', null, 'Asia/Almaty'); // UTC+5, 10 мин по умолчанию
    expect(a.now.toISOString()).toBe('2026-11-12T04:00:00.000Z');
    expect(a.soon?.toISOString()).toBe('2026-11-12T03:50:00.000Z');
    expect(dueFireAt('2026-11-12', '09:00', 0).soon).toBeNull();
    expect(dueFireAt('2026-07-01', '12:00', 60, 'Europe/Berlin').soon?.toISOString()).toBe(
      '2026-07-01T09:00:00.000Z', // UTC+2 летом
    );
  });
});

describe('timed due reminders', () => {
  it('заранее и в срок — по разу; done, архивные и без времени — нет; перенос срока — снова', async () => {
    await raw(`update users set timezone = 'Asia/Almaty' where id = $1`, [w.member.userId]);
    const day = '2026-12-01';
    const t = await task({ dueDate: day, dueTime: '15:00', dueRemindMin: 30 }); // 10:00Z; 09:30Z
    const zero = await task({ dueDate: day, dueTime: '15:00', dueRemindMin: 0 });
    await task({ dueDate: day, dueTime: '15:00', statusId: w.statusIds[3] }); // done
    await task({ dueDate: day }); // no time
    const archived = await task({ dueDate: day, dueTime: '15:00' });
    await w.admin.ok('task.archive', { id: archived });
    const kinds = async (ids: string[]) =>
      (
        await raw(
          `select task_id, kind from notifications where id = any($1) order by kind, task_id`,
          [ids],
        )
      ).map((r) => `${r.task_id === t ? 't' : r.task_id === zero ? 'zero' : '?'}:${r.kind}`);

    expect(await remindDueTime(db, sys, new Date('2026-12-01T09:29:00Z'))).toEqual([]);
    expect(await kinds(await remindDueTime(db, sys, new Date('2026-12-01T09:31:00Z')))).toEqual([
      't:due_soon',
    ]);
    expect(await remindDueTime(db, sys, new Date('2026-12-01T09:32:00Z'))).toEqual([]);
    expect(await kinds(await remindDueTime(db, sys, new Date('2026-12-01T10:00:00Z')))).toEqual([
      't:due_now',
      'zero:due_now',
    ]);
    expect(await remindDueTime(db, sys, new Date('2026-12-01T10:01:00Z'))).toEqual([]);
    // the due time moved — the new moment fires once more
    await w.admin.ok('task.update', { id: t, dueTime: '16:00' });
    expect(await kinds(await remindDueTime(db, sys, new Date('2026-12-01T10:35:00Z')))).toEqual([
      't:due_soon',
    ]);
  });
});
