import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  type MutatorCtx,
  type Row,
  type Tx,
} from '../contract/index.js';
import { bad, need, uuid } from './util.js';

const role = z.enum(['admin', 'member', 'guest']);

async function assertNotLastAdmin(tx: Tx, spaceId: string, memberId: string) {
  const admins = (await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId })).filter(
    (m) => m.role === 'admin',
  );
  if (admins.length === 1 && admins[0].id === memberId)
    throw new MutatorError('conflict', 'последний admin');
}

type Role = z.infer<typeof role>;

/** Deterministic uuid (v8-shaped) of a mirrored row: the client and the server must derive the same id. */
function mirrorId(spaceId: string, userId: string): string {
  const src = `${spaceId}:${userId}`;
  let hex = '';
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1);
    for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193);
    hex += (h >>> 0).toString(16).padStart(8, '0');
  }
  const v = (parseInt(hex[16]!, 16) & 3) | 8;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${v.toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function rootSpaceId(tx: Tx): Promise<string | undefined> {
  const v = (await tx.get('settings', 'root_space'))?.value;
  return typeof v === 'string' ? v : undefined;
}

/** A project member must be a space member (PJ-11): the project rows go with the space row. */
async function dropMember(tx: Tx, m: Row<'spaceMembers'>) {
  for (const pm of await tx.scan('projectMembers', { index: 'userId', eq: m.userId }))
    if (pm.spaceId === m.spaceId) await tx.del('projectMembers', pm.id);
  await tx.del('spaceMembers', m.id);
}

async function setRole(tx: Tx, m: Row<'spaceMembers'>, r: Role, ctx: MutatorCtx) {
  await tx.patch('spaceMembers', m.id, { role: r, updatedAt: ctx.now });
  // a space guest has no higher project role than guest (PJ-11)
  if (r === 'guest')
    for (const pm of await tx.scan('projectMembers', { index: 'userId', eq: m.userId }))
      if (pm.spaceId === m.spaceId && pm.role !== 'guest')
        await tx.patch('projectMembers', pm.id, { role: 'guest', updatedAt: ctx.now });
}

/**
 * Makes the members of the space exactly `want` (userId -> role). Adds and role changes go first, removals last
 * and the actor's own row the very last: the server checks the actor's admin role on every write.
 */
async function reconcile(
  tx: Tx,
  spaceId: string,
  want: Map<string, { id: string; role: Role }>,
  ctx: MutatorCtx,
) {
  const have = await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId });
  const byUser = new Map(have.map((m) => [m.userId, m]));
  for (const [userId, w] of want) {
    const cur = byUser.get(userId);
    if (!cur)
      await tx.put('spaceMembers', {
        id: w.id,
        spaceId,
        userId,
        role: w.role,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    else if (cur.role !== w.role) await setRole(tx, cur, w.role, ctx);
  }
  const drop = have.filter((m) => !want.has(m.userId));
  drop.sort((a, b) => Number(a.userId === ctx.userId) - Number(b.userId === ctx.userId));
  for (const m of drop) await dropMember(tx, m);
}

/** An `inherit` space mirrors the members of the root space (the Workspace) with their roles. */
async function mirrorRoot(tx: Tx, spaceId: string, root: string, ctx: MutatorCtx) {
  const want = new Map(
    (await tx.scan('spaceMembers', { index: 'spaceId', eq: root })).map((m) => [
      m.userId,
      { id: mirrorId(spaceId, m.userId), role: m.role },
    ]),
  );
  await reconcile(tx, spaceId, want, ctx);
}

/** The root space members changed: every `inherit` space follows. */
async function syncInherited(tx: Tx, spaceId: string, ctx: MutatorCtx) {
  const root = await rootSpaceId(tx);
  if (root !== spaceId) return;
  for (const s of await tx.scan('spaces'))
    if (s.membersMode === 'inherit') await mirrorRoot(tx, s.id, root, ctx);
}

async function needOwnList(tx: Tx, spaceId: string) {
  if ((await need(tx, 'spaces', spaceId)).membersMode === 'inherit')
    throw new MutatorError('conflict', 'состав пространства наследуется');
}

export const memberMutators = [
  defineMutator({
    // rights (admin of the space) are checked by the server tx: it writes spaces and spaceMembers
    name: 'space.setMembersMode',
    args: z.object({
      spaceId: uuid,
      mode: z.enum(['inherit', 'custom']),
      members: z.array(z.object({ id: uuid, userId: uuid, role })).optional(),
    }),
    async run(tx, a, ctx) {
      const s = await need(tx, 'spaces', a.spaceId);
      const root = await rootSpaceId(tx);
      if (s.id === root) throw bad('корневое пространство — источник состава, режим не меняется');
      if (a.mode === 'custom') {
        if (!a.members?.length) throw bad('members: нужен непустой состав');
        if (!a.members.some((m) => m.role === 'admin')) throw bad('members: нужен admin');
      }
      if (s.membersMode !== a.mode)
        await tx.patch('spaces', s.id, { membersMode: a.mode, updatedAt: ctx.now });
      if (a.mode === 'inherit') {
        if (!root) throw bad('нет корневого пространства');
        return mirrorRoot(tx, s.id, root, ctx);
      }
      const want = new Map<string, { id: string; role: Role }>();
      for (const m of a.members!) {
        if (want.has(m.userId)) throw bad(`members: ${m.userId} повторяется`);
        if (!(await tx.get('users', m.userId))) throw bad(`${m.userId}: нет пользователя`);
        want.set(m.userId, m);
      }
      await reconcile(tx, s.id, want, ctx);
    },
  }),
  defineMutator({
    name: 'member.add',
    args: z.object({ id: uuid, spaceId: uuid, userId: uuid, role }),
    async run(tx, a, ctx) {
      await needOwnList(tx, a.spaceId);
      const dup = (await tx.scan('spaceMembers', { index: 'spaceId', eq: a.spaceId })).some(
        (m) => m.userId === a.userId,
      );
      if (dup) throw new MutatorError('conflict', 'уже участник');
      await tx.put('spaceMembers', { ...a, createdAt: ctx.now, updatedAt: ctx.now });
      await syncInherited(tx, a.spaceId, ctx);
    },
  }),
  defineMutator({
    name: 'member.update',
    args: z.object({ id: uuid, role }),
    async run(tx, a, ctx) {
      const m = await need(tx, 'spaceMembers', a.id);
      await needOwnList(tx, m.spaceId);
      if (a.role !== 'admin') await assertNotLastAdmin(tx, m.spaceId, m.id);
      await setRole(tx, m, a.role, ctx);
      await syncInherited(tx, m.spaceId, ctx);
    },
  }),
  defineMutator({
    name: 'member.remove',
    args: z.object({ id: uuid }),
    async run(tx, a, ctx) {
      const m = await need(tx, 'spaceMembers', a.id);
      await needOwnList(tx, m.spaceId);
      await assertNotLastAdmin(tx, m.spaceId, m.id);
      await dropMember(tx, m);
      await syncInherited(tx, m.spaceId, ctx);
    },
  }),
];
