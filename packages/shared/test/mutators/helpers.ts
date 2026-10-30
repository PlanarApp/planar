import { MutatorError, createRegistry, domainMutators, uuidv7, type Tx } from '../../src/index';
import { MemoryTx } from '../../src/testing/index';

const reg = createRegistry(domainMutators);
export const T0 = '2026-10-22T10:00:00.000Z';
export const T1 = '2026-10-22T11:00:00.000Z';
export const U1 = uuidv7();
export const U2 = uuidv7();
export const id = uuidv7;
export const ctx = (userId = U1, now = T0) => ({ userId, now, server: false });

export async function run(tx: Tx, name: string, args: unknown, c = ctx()) {
  const d = reg.get(name);
  if (!d) throw new Error(`нет мутатора ${name}`);
  return d.run(tx, d.args.parse(args), c);
}

/** MutatorError code or 'ok'. */
export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof MutatorError ? e.code : `throw:${(e as Error).message}`;
  }
  return 'ok';
}

export const doc = (text = 'hi') => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

export async function seedSpace(tx: Tx, userId = U1) {
  const spaceId = id();
  const statusIds = [id(), id(), id(), id(), id()];
  await run(
    tx,
    'space.create',
    { id: spaceId, name: 'S', rank: 'a0', memberId: id(), statusIds },
    ctx(userId),
  );
  const projectId = id();
  await run(tx, 'project.create', { id: projectId, spaceId, name: 'P', key: 'PRJ', rank: 'a0' });
  return { spaceId, statusIds, projectId };
}

export async function seedTask(
  tx: Tx,
  s: { projectId: string; statusIds: string[] },
  over: object = {},
) {
  const taskId = id();
  await run(tx, 'task.create', {
    id: taskId,
    projectId: s.projectId,
    statusId: s.statusIds[1],
    title: 'T',
    rank: 'a0',
    ...over,
  });
  return taskId;
}

export const mem = () => new MemoryTx();
