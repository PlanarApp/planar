import { expect, it } from 'vitest';
import { code, id, mem, run, seedSpace, seedTask } from './helpers';

const setup = async () => {
  const tx = mem();
  const s = await seedSpace(tx);
  return { tx, s, a: await seedTask(tx, s), b: await seedTask(tx, s), c: await seedTask(tx, s) };
};

it('links: создаётся каждый kind', async () => {
  const { tx, a, b, c } = await setup();
  await run(tx, 'link.create', { id: id(), taskId: a, targetId: b, kind: 'blocks' });
  await run(tx, 'link.create', { id: id(), taskId: a, targetId: c, kind: 'relates' });
  const rows = await tx.scan('taskLinks');
  expect(rows.map((r) => r.kind).sort()).toEqual(['blocks', 'relates']);
  expect(rows[0]).toMatchObject({ taskId: a, spaceId: (await tx.get('tasks', a))!.spaceId });
});

it('links: duplicates создаётся', async () => {
  const { tx, a, b } = await setup();
  await run(tx, 'link.create', { id: id(), taskId: a, targetId: b, kind: 'duplicates' });
  expect(await tx.scan('taskLinks')).toHaveLength(1);
});

it('links: сам с собой — invalid_args', async () => {
  const { tx, a } = await setup();
  expect(
    await code(run(tx, 'link.create', { id: id(), taskId: a, targetId: a, kind: 'relates' })),
  ).toBe('invalid_args');
});

it('links: дубль пары в том же и обратном направлении — conflict', async () => {
  const { tx, a, b } = await setup();
  await run(tx, 'link.create', { id: id(), taskId: a, targetId: b, kind: 'blocks' });
  expect(
    await code(run(tx, 'link.create', { id: id(), taskId: a, targetId: b, kind: 'blocks' })),
  ).toBe('conflict');
  expect(
    await code(run(tx, 'link.create', { id: id(), taskId: b, targetId: a, kind: 'relates' })),
  ).toBe('conflict');
});

it('links: разные пространства и нет задачи', async () => {
  const { tx, a } = await setup();
  const other = await seedTask(tx, await seedSpace(tx));
  expect(
    await code(run(tx, 'link.create', { id: id(), taskId: a, targetId: other, kind: 'relates' })),
  ).toBe('invalid_args');
  expect(
    await code(run(tx, 'link.create', { id: id(), taskId: a, targetId: id(), kind: 'relates' })),
  ).toBe('invalid_args');
});

it('links: task.delete удаляет связи в обе стороны, включая подзадачи', async () => {
  const { tx, s, a, b, c } = await setup();
  const sub = await seedTask(tx, s, { parentId: a });
  await run(tx, 'link.create', { id: id(), taskId: a, targetId: b, kind: 'blocks' });
  await run(tx, 'link.create', { id: id(), taskId: c, targetId: a, kind: 'relates' });
  await run(tx, 'link.create', { id: id(), taskId: b, targetId: sub, kind: 'relates' });
  await run(tx, 'task.delete', { id: a });
  expect(await tx.scan('taskLinks')).toEqual([]);
});

it('links: link.delete удаляет, повтор — ничего', async () => {
  const { tx, a, b } = await setup();
  const l = id();
  await run(tx, 'link.create', { id: l, taskId: a, targetId: b, kind: 'relates' });
  await run(tx, 'link.delete', { id: l });
  await run(tx, 'link.delete', { id: l });
  expect(await tx.scan('taskLinks')).toEqual([]);
});
