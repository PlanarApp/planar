// PJ-1: rights and delivery of project statuses/labels through push/bootstrap
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { key, newDb, world } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

describe('PJ-1 статусы и метки проекта через push', () => {
  it('PJ-1 участник создаёт проект с 5 статусами; статус в существующем проекте — только admin', async () => {
    const w = await world(db);
    const p = uuidv7();
    const statusIds = Array.from({ length: 5 }, () => uuidv7());
    await w.member.ok('project.create', {
      id: p,
      spaceId: w.spaceId,
      name: 'M',
      key: key(),
      rank: 'a5',
      statusIds,
    });
    const b = await w.member.bootstrap();
    const mine = b.data.statuses!.filter((s) => s.projectId === p);
    expect(mine.map((s) => s.id).sort()).toEqual([...statusIds].sort());
    expect(mine.every((s) => s.spaceId === w.spaceId)).toBe(true);

    const st = (project: string) => ({
      id: uuidv7(),
      projectId: project,
      name: 'Review',
      category: 'todo',
      color: '#fff',
      rank: 'a9',
    });
    expect(await w.member.push('status.create', st(p))).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    await w.admin.ok('status.create', st(p));
  });

  it('PJ-1 метка: участник создаёт в проекте, статусы и метки другого проекта задаче не подходят', async () => {
    const w = await world(db);
    const other = uuidv7();
    await w.admin.ok('project.create', {
      id: other,
      spaceId: w.spaceId,
      name: 'O',
      key: key(),
      rank: 'a5',
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    });
    const label = uuidv7();
    await w.member.ok('label.create', { id: label, projectId: other, name: 'L', color: '#000' });
    const t = {
      id: uuidv7(),
      projectId: w.projectId,
      statusId: w.statusIds[1],
      title: 't',
      rank: 'a0',
    };
    expect(
      await w.member.push('task.create', { ...t, labels: [{ id: uuidv7(), labelId: label }] }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    await w.member.ok('task.create', t);
    expect(
      await w.member.push('task.addLabel', { id: uuidv7(), taskId: t.id, labelId: label }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
  });

  it('PJ-1 project.delete: статусы и метки проекта уходят клиентам del-строками', async () => {
    const w = await world(db);
    const p = uuidv7();
    await w.admin.ok('project.create', {
      id: p,
      spaceId: w.spaceId,
      name: 'D',
      key: key(),
      rank: 'a5',
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    });
    await w.admin.ok('label.create', { id: uuidv7(), projectId: p, name: 'L', color: '#000' });
    const { cursor } = await w.admin.bootstrap();
    await w.admin.ok('project.delete', { id: p });
    const pulled = await w.admin.pull(cursor);
    const del = (e: string) => pulled.changes.filter((c) => c.entity === e && c.op === 'del');
    expect(del('statuses')).toHaveLength(5);
    expect(del('labels')).toHaveLength(1);
    expect(del('projects')).toHaveLength(1);
  });
});
