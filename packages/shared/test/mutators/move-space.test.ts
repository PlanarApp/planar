// PLNRAPP-152: a task moves to a project of another space together with its subtasks
import { describe, expect, it } from 'vitest';
import { U1, U2, addProject, code, id, mem, run, seedSpace, seedTask } from './helpers';

async function twoSpaces() {
  const tx = mem();
  const a = await seedSpace(tx);
  const b = await seedSpace(tx);
  const b2 = await addProject(tx, b.spaceId, id(), 'BB2', 'a1');
  await run(tx, 'member.add', { id: id(), spaceId: a.spaceId, userId: U2, role: 'member' });
  return { tx, a, b, b2 };
}

describe('PLNRAPP-152 перенос в другое пространство', () => {
  it('задача с подзадачами всех уровней: spaceId, проект, статус, номер; родитель отрезан; id те же', async () => {
    const { tx, a, b } = await twoSpaces();
    const parent = await seedTask(tx, a);
    const root = await seedTask(tx, a, { parentId: parent, statusId: a.statusIds[3] });
    const kid = await seedTask(tx, a, { parentId: root });
    const grand = await seedTask(tx, a, { parentId: kid });

    await run(tx, 'task.update', { id: root, projectId: b.projectId, title: 'R' });

    for (const t of [root, kid, grand])
      expect(await tx.get('tasks', t)).toMatchObject({
        spaceId: b.spaceId,
        projectId: b.projectId,
        number: null,
        cycleId: null,
        fields: {},
      });
    expect(await tx.get('tasks', root)).toMatchObject({
      title: 'R',
      parentId: null,
      statusId: b.statusIds[3], // Done by name
    });
    expect((await tx.get('tasks', kid))!.parentId).toBe(root);
    expect((await tx.get('tasks', grand))!.parentId).toBe(kid);
    expect((await tx.get('tasks', parent))!.spaceId).toBe(a.spaceId);
  });

  it('исполнители и наблюдатели вне нового пространства снимаются, участники остаются', async () => {
    const { tx, a, b } = await twoSpaces();
    const t = await seedTask(tx, a, {
      assignees: [
        { id: id(), userId: U1 },
        { id: id(), userId: U2 },
      ],
    });
    await run(tx, 'task.update', { id: t, projectId: b.projectId });
    const users = (await tx.scan('taskAssignees', { index: 'taskId', eq: t })).map((x) => x.userId);
    expect(users).toEqual([U1]);
  });

  it('явный статус и родитель — из нового пространства; fields и чужой родитель → invalid_args', async () => {
    const { tx, a, b, b2 } = await twoSpaces();
    const host = await seedTask(tx, b);
    const t = await seedTask(tx, a);
    await run(tx, 'task.update', {
      id: t,
      projectId: b2.projectId,
      statusId: b2.statusIds[2],
      parentId: host,
    });
    expect(await tx.get('tasks', t)).toMatchObject({ statusId: b2.statusIds[2], parentId: host });

    const u = await seedTask(tx, a);
    const other = await seedTask(tx, a);
    for (const bad of [{ statusId: a.statusIds[0] }, { parentId: other }, { fields: {} }])
      expect(await code(run(tx, 'task.update', { id: u, projectId: b.projectId, ...bad }))).toBe(
        'invalid_args',
      );
  });
});
