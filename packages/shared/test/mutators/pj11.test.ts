// PJ-11: project members (C-schema v17, C-mutators v14), mutators on MemoryTx
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSIONS } from '../../src/index';
import { code, ctx, id, mem, run, seedSpace, U1, U2 } from './helpers';

const U3 = id();

/** Space with U1 (admin), U2 (member), U3 (guest) and one project. */
async function setup() {
  const tx = mem();
  const s = await seedSpace(tx);
  for (const [userId, role] of [
    [U2, 'member'],
    [U3, 'guest'],
  ] as const)
    await run(tx, 'member.add', { id: id(), spaceId: s.spaceId, userId, role }, ctx(U1));
  const members = async () => tx.scan('projectMembers', { index: 'projectId', eq: s.projectId });
  const mode = async () => (await tx.get('projects', s.projectId))!.membersMode;
  const custom = (list: { userId: string; role: 'admin' | 'member' | 'guest' }[]) =>
    run(tx, 'project.setMembersMode', {
      projectId: s.projectId,
      mode: 'custom',
      members: list.map((m) => ({ id: id(), ...m })),
    });
  return { tx, s, members, mode, custom };
}

describe('pj11: project.setMembersMode', () => {
  it('pj11 новый проект наследует состав; custom создаёт строки, inherit их удаляет', async () => {
    const { tx, s, members, mode, custom } = await setup();
    expect(await mode()).toBe('inherit');
    await custom([{ userId: U2, role: 'member' }]);
    expect(await mode()).toBe('custom');
    expect((await members()).map((m) => [m.userId, m.role, m.spaceId])).toEqual([
      [U2, 'member', s.spaceId],
    ]);
    await run(tx, 'project.setMembersMode', { projectId: s.projectId, mode: 'inherit' });
    expect(await mode()).toBe('inherit');
    expect(await members()).toEqual([]);
  });

  it('pj11 повтор идемпотентен, второй вызов custom заменяет состав', async () => {
    const { tx, s, members, custom } = await setup();
    await custom([{ userId: U1, role: 'admin' }]);
    await custom([
      { userId: U2, role: 'guest' },
      { userId: U1, role: 'admin' },
    ]);
    expect((await members()).map((m) => m.userId).sort()).toEqual([U1, U2].sort());
    await custom([{ userId: U2, role: 'member' }]);
    const rows = await members();
    expect(rows.map((m) => [m.userId, m.role])).toEqual([[U2, 'member']]);
    await run(tx, 'project.setMembersMode', { projectId: s.projectId, mode: 'inherit' });
    await run(tx, 'project.setMembersMode', { projectId: s.projectId, mode: 'inherit' });
    expect(await members()).toEqual([]);
  });

  it('pj11 custom: состав обязателен, участники пространства, гость пространства — только guest', async () => {
    const { tx, s, custom } = await setup();
    const bad = (members?: unknown) =>
      code(run(tx, 'project.setMembersMode', { projectId: s.projectId, mode: 'custom', members }));
    expect(await bad(undefined)).toBe('invalid_args');
    expect(await bad([])).toBe('invalid_args');
    expect(await bad([{ id: id(), userId: id(), role: 'member' }])).toBe('invalid_args');
    expect(await bad([{ id: id(), userId: U3, role: 'member' }])).toBe('invalid_args');
    expect(
      await bad([
        { id: id(), userId: U2, role: 'member' },
        { id: id(), userId: U2, role: 'guest' },
      ]),
    ).toBe('invalid_args');
    expect(await code(custom([{ userId: U3, role: 'guest' }]))).toBe('ok');
    expect(
      await code(run(tx, 'project.setMembersMode', { projectId: id(), mode: 'inherit' })),
    ).toBe('not_found');
  });
});

describe('pj11: projectMember.*', () => {
  it('pj11 add/setRole/remove работают только в режиме custom', async () => {
    const { tx, s, members, custom } = await setup();
    const rowId = id();
    const add = (userId = U2, rid = rowId) =>
      run(tx, 'projectMember.add', { id: rid, projectId: s.projectId, userId, role: 'member' });
    expect(await code(add())).toBe('conflict');
    await custom([{ userId: U1, role: 'admin' }]);
    expect(await code(add())).toBe('ok');
    expect(await code(add(U2, id()))).toBe('conflict'); // already a member
    expect(await code(add(id(), id()))).toBe('invalid_args'); // not a space member
    await run(tx, 'projectMember.setRole', { id: rowId, role: 'guest' });
    expect((await tx.get('projectMembers', rowId))!.role).toBe('guest');
    expect(await code(run(tx, 'projectMember.setRole', { id: rowId, role: 'admin' }))).toBe('ok');
    await run(tx, 'projectMember.remove', { id: rowId });
    expect((await members()).map((m) => m.userId)).toEqual([U1]);
    await run(tx, 'project.setMembersMode', { projectId: s.projectId, mode: 'inherit' });
    expect(await code(run(tx, 'projectMember.remove', { id: rowId }))).toBe('not_found');
  });

  it('pj11 гость пространства не получает роль выше guest; понижение роли в пространстве понижает и проектную', async () => {
    const { tx, s, custom, members } = await setup();
    await custom([{ userId: U1, role: 'admin' }]);
    const rowId = id();
    const add = (role: string) =>
      run(tx, 'projectMember.add', { id: rowId, projectId: s.projectId, userId: U3, role });
    expect(await code(add('member'))).toBe('invalid_args');
    expect(await code(add('guest'))).toBe('ok');
    expect(await code(run(tx, 'projectMember.setRole', { id: rowId, role: 'admin' }))).toBe(
      'invalid_args',
    );
    const u2 = id();
    await run(tx, 'projectMember.add', {
      id: u2,
      projectId: s.projectId,
      userId: U2,
      role: 'admin',
    });
    const sm = (await tx.scan('spaceMembers', { index: 'userId', eq: U2 }))[0]!;
    await run(tx, 'member.update', { id: sm.id, role: 'guest' });
    expect((await members()).find((m) => m.userId === U2)!.role).toBe('guest');
  });

  it('pj11 удаление участника пространства, проекта и пространства убирает строки projectMembers', async () => {
    const { tx, s, custom, members } = await setup();
    await custom([
      { userId: U1, role: 'admin' },
      { userId: U2, role: 'member' },
    ]);
    const sm = (await tx.scan('spaceMembers', { index: 'userId', eq: U2 }))[0]!;
    await run(tx, 'member.remove', { id: sm.id });
    expect((await members()).map((m) => m.userId)).toEqual([U1]);
    await run(tx, 'project.delete', { id: s.projectId });
    expect(await tx.scan('projectMembers')).toEqual([]);
  });
});

describe('pj11: версии контракта', () => {
  it('pj11 C-schema 17, C-mutators 14', () => {
    expect(CONTRACT_VERSIONS['C-schema']).toBe(17);
    expect(CONTRACT_VERSIONS['C-mutators']).toBe(14);
  });
});
