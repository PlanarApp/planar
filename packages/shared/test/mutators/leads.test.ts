// PLANARAPP-3, -4: space lead, project default assignee (C-schema v18, C-mutators v15)
import { describe, expect, it } from 'vitest';
import { U1, U2, id, mem, run, seedSpace, seedTask } from './helpers';

describe('PLANARAPP-3/4: руководитель и исполнитель по умолчанию', () => {
  it('space.update задаёт и снимает руководителя пространства', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    expect((await tx.get('spaces', s.spaceId))!.leadId).toBeNull();
    await run(tx, 'space.update', { id: s.spaceId, leadId: U1 });
    expect((await tx.get('spaces', s.spaceId))!.leadId).toBe(U1);
    await run(tx, 'space.update', { id: s.spaceId, leadId: null });
    expect((await tx.get('spaces', s.spaceId))!.leadId).toBeNull();
  });

  it('task.create без исполнителей назначает исполнителя проекта по умолчанию', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    await run(tx, 'project.update', { id: s.projectId, defaultAssigneeId: U2 });
    const t = await seedTask(tx, s);
    const rows = await tx.scan('taskAssignees', { index: 'taskId', eq: t });
    expect(rows.map((r) => [r.id, r.userId])).toEqual([[t, U2]]);
  });

  it('явные исполнители важнее; без настройки — никого', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const plain = await seedTask(tx, s);
    expect(await tx.scan('taskAssignees', { index: 'taskId', eq: plain })).toEqual([]);
    await run(tx, 'project.update', { id: s.projectId, defaultAssigneeId: U2 });
    const t = await seedTask(tx, s, { assignees: [{ id: id(), userId: U1 }] });
    const rows = await tx.scan('taskAssignees', { index: 'taskId', eq: t });
    expect(rows.map((r) => r.userId)).toEqual([U1]);
  });
});
