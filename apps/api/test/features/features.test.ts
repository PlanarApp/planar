import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { ServerTx } from '../../src/sync/server-tx.js';
import { NOW, newDb, taskArgs, world } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

const fieldArgs = (w: { projectId: string }, over = {}) => ({
  id: uuidv7(),
  projectId: w.projectId,
  name: 'F',
  type: 'text',
  rank: 'a0',
  ...over,
});

describe('features', () => {
  it('features: fieldDefs и taskLinks в bootstrap и pull участника, не у чужого', async () => {
    const w = await world(db);
    const { cursor } = await w.member.bootstrap();
    const a = taskArgs(w);
    const b = taskArgs(w);
    const f = fieldArgs(w);
    const l = { id: uuidv7(), taskId: a.id, targetId: b.id, kind: 'blocks' };
    await w.admin.ok('task.create', a);
    await w.admin.ok('task.create', b);
    await w.admin.ok('field.create', f);
    await w.admin.ok('link.create', l);
    const pulled = (await w.member.pull(cursor)).changes.map((c) => `${c.entity}:${c.id}`);
    expect(pulled).toContain(`fieldDefs:${f.id}`);
    expect(pulled).toContain(`taskLinks:${l.id}`);
    const boot = (await w.member.bootstrap()).data;
    expect(boot.fieldDefs!.map((r) => r.id)).toContain(f.id);
    expect(boot.taskLinks!.map((r) => r.id)).toContain(l.id);
    const out = (await w.outsider.bootstrap()).data;
    expect(out.fieldDefs ?? []).toEqual([]);
    expect(out.taskLinks ?? []).toEqual([]);
  });

  it('features: guest не может field.create и link.create', async () => {
    const w = await world(db);
    const r = await w.guest.push('field.create', fieldArgs(w));
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('features: уникальный индекс пары даёт conflict при прямой вставке обратной пары', async () => {
    const w = await world(db);
    const a = taskArgs(w);
    const b = taskArgs(w);
    await w.admin.ok('task.create', a);
    await w.admin.ok('task.create', b);
    await w.admin.ok('link.create', {
      id: uuidv7(),
      taskId: a.id,
      targetId: b.id,
      kind: 'relates',
    });
    const res = await db
      .transaction(async (pg) => {
        const tx = new ServerTx(pg, { userId: w.admin.userId, now: NOW });
        await tx.put('taskLinks', {
          id: uuidv7(),
          spaceId: w.spaceId,
          taskId: b.id,
          targetId: a.id,
          kind: 'relates',
          createdBy: w.admin.userId,
          createdAt: NOW,
        });
        return 'ok';
      })
      .catch((e: { code?: string }) => e.code);
    expect(res).toBe('conflict');
  });

  it('features: field.delete на сервере пишет changes по задачам', async () => {
    const w = await world(db);
    const f = fieldArgs(w);
    const t = taskArgs(w);
    await w.admin.ok('field.create', f);
    await w.admin.ok('task.create', t);
    await w.admin.ok('task.setField', { taskId: t.id, fieldId: f.id, value: 'v' });
    const { cursor } = await w.member.bootstrap();
    await w.admin.ok('field.delete', { id: f.id });
    const ch = (await w.member.pull(cursor)).changes;
    const task = ch.find((c) => c.entity === 'tasks' && c.id === t.id);
    expect((task?.data as { fields: object }).fields).toEqual({});
    expect(ch.some((c) => c.entity === 'fieldDefs' && c.id === f.id && c.op === 'del')).toBe(true);
  });
});
