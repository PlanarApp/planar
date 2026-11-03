// PJ-1: statuses and labels belong to a project (C-schema v15, C-mutators v11)
import { describe, expect, it } from 'vitest';
import { addProject, code, id, mem, run, seedSpace, seedTask } from './helpers';

const label = async (tx: ReturnType<typeof mem>, projectId: string, name: string) => {
  const l = id();
  await run(tx, 'label.create', { id: l, projectId, name, color: '#000' });
  return l;
};

async function twoProjects() {
  const tx = mem();
  const a = await seedSpace(tx);
  const b = await addProject(tx, a.spaceId, id(), 'BBB', 'a1');
  return { tx, a, b };
}

describe('PJ-1: принадлежность статусов и меток проекту', () => {
  it('PJ-1 task.create: статус и метка другого проекта того же пространства → invalid_args', async () => {
    const { tx, a, b } = await twoProjects();
    const lb = await label(tx, b.projectId, 'x');
    const args = {
      id: id(),
      projectId: a.projectId,
      statusId: a.statusIds[1],
      title: 't',
      rank: 'a0',
    };
    expect(await code(run(tx, 'task.create', { ...args, statusId: b.statusIds[1] }))).toBe(
      'invalid_args',
    );
    expect(
      await code(run(tx, 'task.create', { ...args, labels: [{ id: id(), labelId: lb }] })),
    ).toBe('invalid_args');
    expect(await code(run(tx, 'task.create', args))).toBe('ok');
  });

  it('PJ-1 task.update/addLabel: статус и метка чужого проекта → invalid_args', async () => {
    const { tx, a, b } = await twoProjects();
    const t = await seedTask(tx, a);
    const lb = await label(tx, b.projectId, 'x');
    expect(await code(run(tx, 'task.update', { id: t, statusId: b.statusIds[0] }))).toBe(
      'invalid_args',
    );
    expect(await code(run(tx, 'task.addLabel', { id: id(), taskId: t, labelId: lb }))).toBe(
      'invalid_args',
    );
  });

  it('PJ-1 status.create/label.create: spaceId берётся из проекта', async () => {
    const { tx, b, a } = await twoProjects();
    const l = await label(tx, b.projectId, 'x');
    expect(await tx.get('labels', l)).toMatchObject({ projectId: b.projectId, spaceId: a.spaceId });
    expect(await tx.get('statuses', b.statusIds[0]!)).toMatchObject({
      projectId: b.projectId,
      spaceId: a.spaceId,
    });
  });

  it('PJ-1 status.delete: последний статус проекта → conflict, даже если в пространстве есть другие', async () => {
    const { tx, a, b } = await twoProjects();
    expect(
      await code(run(tx, 'status.delete', { id: b.statusIds[1], replaceWith: a.statusIds[0] })),
    ).toBe('invalid_args');
    for (const s of b.statusIds.slice(1))
      await run(tx, 'status.delete', { id: s, replaceWith: b.statusIds[0] });
    expect(
      await code(run(tx, 'status.delete', { id: b.statusIds[0], replaceWith: a.statusIds[0] })),
    ).toBe('conflict');
  });

  it('PJ-1 project.delete: удаляет статусы и метки проекта, соседний проект цел', async () => {
    const { tx, a, b } = await twoProjects();
    await label(tx, b.projectId, 'x');
    const la = await label(tx, a.projectId, 'x');
    await run(tx, 'project.delete', { id: b.projectId });
    expect(await tx.scan('statuses', { index: 'projectId', eq: b.projectId })).toEqual([]);
    expect(await tx.scan('labels', { index: 'projectId', eq: b.projectId })).toEqual([]);
    expect(await tx.get('labels', la)).toBeDefined();
    expect(await tx.scan('statuses', { index: 'projectId', eq: a.projectId })).toHaveLength(5);
  });
});

describe('PJ-1: перенос задачи в другой проект', () => {
  it('PJ-1 task.update projectId: статус по имени, иначе по категории, иначе первый; метки по имени', async () => {
    const { tx, a, b } = await twoProjects();
    // the target project: rename Todo -> «todo» differs by case only, drop «Done»
    await run(tx, 'status.update', { id: b.statusIds[1], name: 'TODO' });
    await run(tx, 'status.delete', { id: b.statusIds[3], replaceWith: b.statusIds[4] });
    const keep = await label(tx, a.projectId, 'Bug');
    const lost = await label(tx, a.projectId, 'Only-A');
    const bBug = await label(tx, b.projectId, 'bug');
    const t = await seedTask(tx, a, {
      labels: [
        { id: id(), labelId: keep },
        { id: id(), labelId: lost },
      ],
    });

    await run(tx, 'task.update', { id: t, projectId: b.projectId });
    expect((await tx.get('tasks', t))!.statusId).toBe(b.statusIds[1]); // same name, case-insensitive
    expect((await tx.scan('taskLabels', { index: 'taskId', eq: t })).map((x) => x.labelId)).toEqual(
      [bBug],
    );

    // «Done» has no counterpart in b: same category -> none left (deleted), the first status by rank
    const d = await seedTask(tx, a, { statusId: a.statusIds[3] });
    await run(tx, 'task.update', { id: d, projectId: b.projectId });
    expect((await tx.get('tasks', d))!.statusId).toBe(b.statusIds[0]);
    expect((await tx.get('tasks', d))!.completedAt).toBeNull();
  });

  it('PJ-1 task.update projectId: категория, если имени нет; явный statusId побеждает и проверяется', async () => {
    const { tx, a, b } = await twoProjects();
    await run(tx, 'status.update', { id: b.statusIds[2], name: 'Doing' });
    const t = await seedTask(tx, a, { statusId: a.statusIds[2] }); // In Progress
    await run(tx, 'task.update', { id: t, projectId: b.projectId });
    expect((await tx.get('tasks', t))!.statusId).toBe(b.statusIds[2]); // same category

    const u = await seedTask(tx, a);
    await run(tx, 'task.update', { id: u, projectId: b.projectId, statusId: b.statusIds[3] });
    expect(await tx.get('tasks', u)).toMatchObject({ statusId: b.statusIds[3] });
    expect((await tx.get('tasks', u))!.completedAt).not.toBeNull();

    const v = await seedTask(tx, a);
    expect(
      await code(
        run(tx, 'task.update', { id: v, projectId: b.projectId, statusId: a.statusIds[0] }),
      ),
    ).toBe('invalid_args');
  });
});

describe('PJ-1: копирование справочников', () => {
  it('PJ-1 project.copyDictionaries: копирует, идемпотентно по имени', async () => {
    const { tx, a } = await twoProjects();
    const c = await addProject(tx, a.spaceId, id(), 'CCC', 'a2');
    const l1 = await label(tx, a.projectId, 'Bug');
    await label(tx, c.projectId, 'bug'); // exists in the target (case-insensitive)
    const l2 = await label(tx, a.projectId, 'Feat');
    const args = {
      projectId: c.projectId,
      fromProjectId: a.projectId,
      statuses: [
        { id: id(), fromId: a.statusIds[0]! }, // Backlog: exists in c -> skipped
      ],
      labels: [
        { id: id(), fromId: l1 },
        { id: id(), fromId: l2 },
      ],
    };
    await run(tx, 'project.copyDictionaries', args);
    await run(tx, 'status.update', { id: a.statusIds[0], rank: 'zz' });
    const names = (await tx.scan('labels', { index: 'projectId', eq: c.projectId })).map(
      (l) => l.name,
    );
    expect(names.sort()).toEqual(['Feat', 'bug']);
    expect(await tx.scan('statuses', { index: 'projectId', eq: c.projectId })).toHaveLength(5);
    // a repeat creates nothing
    await run(tx, 'project.copyDictionaries', {
      ...args,
      statuses: [],
      labels: args.labels.map((x) => ({ ...x, id: id() })),
    });
    expect(await tx.scan('labels', { index: 'projectId', eq: c.projectId })).toHaveLength(2);
  });

  it('PJ-1 project.copyDictionaries: чужое пространство и элемент не из источника → invalid_args', async () => {
    const { tx, a, b } = await twoProjects();
    const other = await seedSpace(tx);
    const base = { projectId: b.projectId, fromProjectId: a.projectId, labels: [] };
    expect(
      await code(
        run(tx, 'project.copyDictionaries', {
          ...base,
          fromProjectId: other.projectId,
          statuses: [{ id: id(), fromId: other.statusIds[0]! }],
        }),
      ),
    ).toBe('invalid_args');
    expect(
      await code(
        run(tx, 'project.copyDictionaries', {
          ...base,
          statuses: [{ id: id(), fromId: other.statusIds[0]! }],
        }),
      ),
    ).toBe('invalid_args');
  });

  it('PJ-1 project.create copyFrom: статусы и метки копируются из проекта того же пространства', async () => {
    const { tx, a } = await twoProjects();
    const l = await label(tx, a.projectId, 'Bug');
    await run(tx, 'status.update', { id: a.statusIds[1], name: 'Next' });
    const p = id();
    const sid = [id(), id()];
    await run(tx, 'project.create', {
      id: p,
      spaceId: a.spaceId,
      name: 'N',
      key: 'NEW',
      rank: 'a9',
      copyFrom: {
        projectId: a.projectId,
        statuses: [
          { id: sid[0], fromId: a.statusIds[1] },
          { id: sid[1], fromId: a.statusIds[3] },
        ],
        labels: [{ id: id(), fromId: l }],
      },
    });
    const sts = await tx.scan('statuses', { index: 'projectId', eq: p });
    expect(sts.map((s) => [s.name, s.category]).sort()).toEqual([
      ['Done', 'done'],
      ['Next', 'todo'],
    ]);
    expect(await tx.scan('labels', { index: 'projectId', eq: p })).toMatchObject([
      { name: 'Bug', spaceId: a.spaceId },
    ]);
    // another space: invalid_args
    const other = await seedSpace(tx);
    expect(
      await code(
        run(tx, 'project.create', {
          id: id(),
          spaceId: a.spaceId,
          name: 'N',
          key: 'NEW2',
          rank: 'a9',
          copyFrom: { projectId: other.projectId, statuses: [], labels: [] },
        }),
      ),
    ).toBe('invalid_args');
  });
});
