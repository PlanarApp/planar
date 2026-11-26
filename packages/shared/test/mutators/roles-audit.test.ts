// Roles audit 2026-11-26: instance role caps, project admin rights, leaving the Workspace — mutators on MemoryTx
import { describe, expect, it } from 'vitest';
import { code, ctx, id, mem, run, seedSpace, T0, U1, U2 } from './helpers';

const G = id(); // instance guest
const A = id(); // instance admin, member of no space
const user = (
  userId: string,
  role: 'owner' | 'admin' | 'member' | 'guest',
  deactivatedAt = null,
) => ({
  id: userId,
  login: userId,
  name: userId,
  email: null,
  role,
  avatarFile: null,
  deactivatedAt,
  bot: false,
  createdAt: T0,
  updatedAt: T0,
});

async function setup() {
  const tx = mem();
  for (const [u, r] of [
    [U1, 'member'],
    [U2, 'member'],
    [G, 'guest'],
    [A, 'admin'],
  ] as const)
    await tx.put('users', user(u, r) as never);
  const s = await seedSpace(tx);
  await run(tx, 'member.add', { id: id(), spaceId: s.spaceId, userId: U2, role: 'member' });
  return { tx, s };
}

describe('роль ограничена ролью инстанса', () => {
  it('гость инстанса — только guest в спейсе', async () => {
    const { tx, s } = await setup();
    const add = (role: string) =>
      code(run(tx, 'member.add', { id: id(), spaceId: s.spaceId, userId: G, role }));
    expect(await add('member')).toBe('invalid_args');
    expect(await add('guest')).toBe('ok');
    const [m] = await tx.scan('spaceMembers', { index: 'userId', eq: G });
    expect(await code(run(tx, 'member.update', { id: m!.id, role: 'admin' }))).toBe('invalid_args');
  });
});

describe('project.update / delete — admin проекта', () => {
  it('member спейса — forbidden, admin спейса и admin инстанса — ok', async () => {
    const { tx, s } = await setup();
    const upd = (userId: string) =>
      code(run(tx, 'project.update', { id: s.projectId, name: 'N' }, ctx(userId)));
    expect(await upd(U2)).toBe('forbidden');
    expect(await upd(U1)).toBe('ok');
    expect(await upd(A)).toBe('ok');
    expect(await code(run(tx, 'project.delete', { id: s.projectId }, ctx(U2)))).toBe('forbidden');
    expect(await code(run(tx, 'project.delete', { id: s.projectId }, ctx(A)))).toBe('ok');
  });
});

describe('уход из Воркспейса', () => {
  it('member.remove корневой строки убирает из custom-спейса и его проектных составов', async () => {
    const { tx, s } = await setup();
    const root = id();
    await run(tx, 'space.create', { id: root, name: 'R', rank: 'a1', memberId: id() });
    await tx.put('settings', { id: 'root_space', value: root, updatedAt: T0 } as never);
    await run(tx, 'member.add', { id: id(), spaceId: root, userId: U2, role: 'member' });
    await run(tx, 'project.setMembersMode', {
      projectId: s.projectId,
      mode: 'custom',
      members: [
        { id: id(), userId: U1, role: 'admin' },
        { id: id(), userId: U2, role: 'member' },
      ],
    });
    const [row] = (await tx.scan('spaceMembers', { index: 'spaceId', eq: root })).filter(
      (m) => m.userId === U2,
    );
    await run(tx, 'member.remove', { id: row!.id });
    expect(await tx.scan('spaceMembers', { index: 'userId', eq: U2 })).toEqual([]);
    expect(await tx.scan('projectMembers', { index: 'userId', eq: U2 })).toEqual([]);
  });
});
