import { z } from 'zod';
import {
  MODULE_DEPS,
  MutatorError,
  defineMutator,
  isDataModule,
  withModuleDeps,
  type Tx,
} from '../contract/index.js';
import { bad, changes, color, delWhere, doc, name, need, rank, uuid } from './util.js';

const key = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/);

const CATEGORIES = [
  ['backlog', 'Backlog', '#94a3b8'],
  ['todo', 'Todo', '#64748b'],
  ['in_progress', 'In Progress', '#3b82f6'],
  ['done', 'Done', '#22c55e'],
  ['cancelled', 'Cancelled', '#ef4444'],
] as const;

const customName = (v?: string) => (v && v.trim().length <= 64 ? v.trim() || undefined : undefined);

const role = z.enum(['admin', 'member', 'guest']);
type Role = z.infer<typeof role>;

async function spaceRoles(tx: Tx, spaceId: string) {
  return new Map(
    (await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId })).map((m) => [
      m.userId,
      m.role,
    ]),
  );
}

/** A project member is a member of the space; a space guest is at most a guest in the project (PJ-11). */
function checkRole(space: Map<string, Role>, userId: string, r: Role) {
  const sr = space.get(userId);
  if (!sr) throw bad(`${userId}: не участник пространства`);
  if (sr === 'guest' && r !== 'guest') throw bad(`${userId}: гость пространства — только guest`);
}

const pairs = z.array(z.object({ id: uuid, fromId: uuid }));
const copyArgs = z.object({ statuses: pairs, labels: pairs });
type Copy = z.infer<typeof copyArgs>;

/** Copies the listed statuses/labels of `fromId` into the project (same space); a same-named target item (case-insensitive) is skipped. */
async function copyDictionaries(
  tx: Tx,
  now: string,
  to: { id: string; spaceId: string },
  fromProjectId: string,
  a: Copy,
) {
  const from = await need(tx, 'projects', fromProjectId);
  if (from.spaceId !== to.spaceId) throw bad('проект-источник другого пространства');
  for (const [entity, list] of [
    ['statuses', a.statuses],
    ['labels', a.labels],
  ] as const) {
    const have = new Set(
      (await tx.scan(entity, { index: 'projectId', eq: to.id })).map((x) => x.name.toLowerCase()),
    );
    for (const { id, fromId } of list) {
      const src = await need(tx, entity, fromId);
      if (src.projectId !== fromProjectId) throw bad(`${entity} ${fromId} не из проекта-источника`);
      if (have.has(src.name.toLowerCase())) continue;
      have.add(src.name.toLowerCase());
      await tx.put(entity, {
        ...src,
        id,
        projectId: to.id,
        createdAt: now,
        updatedAt: now,
      } as never);
    }
  }
}

export const projectMutators = [
  defineMutator({
    name: 'project.create',
    args: z.object({
      id: uuid,
      spaceId: uuid,
      name,
      key,
      rank,
      description: doc.nullable().optional(),
      color: color.nullable().optional(),
      icon: z.string().nullable().optional(),
      leadId: uuid.nullable().optional(),
      defaultAssigneeId: uuid.nullable().optional(),
      statusIds: z.array(uuid).length(5).optional(),
      statusNames: z
        .partialRecord(z.enum(CATEGORIES.map((c) => c[0]) as [string, ...string[]]), z.string())
        .optional(),
      copyFrom: copyArgs.extend({ projectId: uuid }).optional(),
      modules: z.array(z.string()).optional(),
    }),
    async run(tx, a, ctx) {
      const { statusIds, statusNames, copyFrom, modules, ...p } = a;
      if (modules?.some((m) => !isDataModule(m)))
        throw new MutatorError('invalid_args', 'modules: только модули данных');
      if (!copyFrom && !statusIds) throw bad('нужны statusIds или copyFrom');
      await need(tx, 'spaces', a.spaceId);
      // the root space is the Workspace level: it holds only documents and chats, no projects
      if ((await tx.get('settings', 'root_space'))?.value === a.spaceId)
        throw new MutatorError('invalid_args', 'в корневом пространстве нельзя создать проект');
      await tx.put('projects', {
        ...p,
        description: a.description ?? null,
        color: a.color ?? null,
        icon: a.icon ?? null,
        leadId: a.leadId ?? null,
        defaultAssigneeId: a.defaultAssigneeId ?? null,
        archivedAt: null,
        modules: withModuleDeps(modules ?? []),
        membersMode: 'inherit',
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      if (copyFrom)
        await copyDictionaries(
          tx,
          ctx.now,
          { id: a.id, spaceId: a.spaceId },
          copyFrom.projectId,
          copyFrom,
        );
      else
        for (const [i, [category, title, c]] of CATEGORIES.entries())
          await tx.put('statuses', {
            id: statusIds![i]!,
            spaceId: a.spaceId,
            projectId: a.id,
            name: customName(statusNames?.[category]) ?? title,
            category,
            color: c,
            rank: `a${i}`,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          });
    },
  }),
  defineMutator({
    name: 'project.copyDictionaries',
    args: z.object({ projectId: uuid, fromProjectId: uuid }).extend(copyArgs.shape),
    async run(tx, a, ctx) {
      const to = await need(tx, 'projects', a.projectId);
      await copyDictionaries(tx, ctx.now, to, a.fromProjectId, a);
    },
  }),
  defineMutator({
    name: 'project.update',
    args: z.object({
      id: uuid,
      name: name.optional(),
      key: key.optional(),
      description: doc.nullable().optional(),
      color: color.nullable().optional(),
      icon: z.string().nullable().optional(),
      leadId: uuid.nullable().optional(),
      defaultAssigneeId: uuid.nullable().optional(),
      rank: rank.optional(),
      archivedAt: z.iso.datetime().nullable().optional(),
    }),
    async run(tx, a, ctx) {
      await need(tx, 'projects', a.id);
      await tx.patch('projects', a.id, changes('projects', a, ctx));
    },
  }),
  defineMutator({
    // rights (admin of the space / instance admin) and `unavailable` are checked by the server tx
    name: 'project.setModule',
    args: z.object({ projectId: uuid, moduleId: z.string(), enabled: z.boolean() }),
    async run(tx, a, ctx) {
      if (!isDataModule(a.moduleId))
        throw new MutatorError('invalid_args', `${a.moduleId}: не модуль данных`);
      const p = await need(tx, 'projects', a.projectId);
      const have = p.modules ?? [];
      if (have.includes(a.moduleId) === a.enabled) return;
      // ai needs automations: they go on together, and off together from the needed one
      const next = a.enabled
        ? withModuleDeps([...have, a.moduleId])
        : have.filter((x) => x !== a.moduleId && !MODULE_DEPS[x]?.includes(a.moduleId));
      await tx.patch('projects', a.projectId, {
        modules: next,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    // rights (admin of the space / instance admin) are checked by the server tx
    name: 'project.setMembersMode',
    args: z.object({
      projectId: uuid,
      mode: z.enum(['inherit', 'custom']),
      members: z.array(z.object({ id: uuid, userId: uuid, role })).optional(),
    }),
    async run(tx, a, ctx) {
      const p = await need(tx, 'projects', a.projectId);
      const have = await tx.scan('projectMembers', { index: 'projectId', eq: p.id });
      if (a.mode === 'inherit') {
        for (const m of have) await tx.del('projectMembers', m.id);
      } else {
        if (!a.members?.length) throw bad('members: нужен непустой состав');
        const space = await spaceRoles(tx, p.spaceId);
        const want = new Map<string, { id: string; role: Role }>();
        for (const m of a.members) {
          if (want.has(m.userId)) throw bad(`members: ${m.userId} повторяется`);
          checkRole(space, m.userId, m.role);
          want.set(m.userId, m);
        }
        const byUser = new Map(have.map((m) => [m.userId, m]));
        for (const m of have) if (!want.has(m.userId)) await tx.del('projectMembers', m.id);
        for (const [userId, m] of want) {
          const cur = byUser.get(userId);
          if (!cur)
            await tx.put('projectMembers', {
              id: m.id,
              spaceId: p.spaceId,
              projectId: p.id,
              userId,
              role: m.role,
              createdAt: ctx.now,
              updatedAt: ctx.now,
            });
          else if (cur.role !== m.role)
            await tx.patch('projectMembers', cur.id, { role: m.role, updatedAt: ctx.now });
        }
      }
      if (p.membersMode !== a.mode)
        await tx.patch('projects', p.id, { membersMode: a.mode, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'projectMember.add',
    args: z.object({ id: uuid, projectId: uuid, userId: uuid, role }),
    async run(tx, a, ctx) {
      const p = await need(tx, 'projects', a.projectId);
      if (p.membersMode !== 'custom')
        throw new MutatorError('conflict', 'состав проекта наследуется');
      checkRole(await spaceRoles(tx, p.spaceId), a.userId, a.role);
      const dup = (await tx.scan('projectMembers', { index: 'projectId', eq: p.id })).some(
        (m) => m.userId === a.userId,
      );
      if (dup) throw new MutatorError('conflict', 'уже участник проекта');
      await tx.put('projectMembers', {
        ...a,
        spaceId: p.spaceId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'projectMember.setRole',
    args: z.object({ id: uuid, role }),
    async run(tx, a, ctx) {
      const m = await need(tx, 'projectMembers', a.id);
      const p = await need(tx, 'projects', m.projectId);
      if (p.membersMode !== 'custom')
        throw new MutatorError('conflict', 'состав проекта наследуется');
      checkRole(await spaceRoles(tx, p.spaceId), m.userId, a.role);
      await tx.patch('projectMembers', a.id, { role: a.role, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'projectMember.remove',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      const m = await need(tx, 'projectMembers', a.id);
      const p = await need(tx, 'projects', m.projectId);
      if (p.membersMode !== 'custom')
        throw new MutatorError('conflict', 'состав проекта наследуется');
      await tx.del('projectMembers', a.id);
    },
  }),
  defineMutator({
    name: 'project.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await need(tx, 'projects', a.id);
      if ((await tx.scan('tasks', { index: 'projectId', eq: a.id })).length)
        throw new MutatorError('conflict', 'есть задачи');
      await delWhere(tx, 'fieldDefs', 'projectId', a.id);
      await delWhere(tx, 'projectMembers', 'projectId', a.id);
      for (const l of await tx.scan('labels', { index: 'projectId', eq: a.id })) {
        await delWhere(tx, 'taskLabels', 'labelId', l.id);
        await tx.del('labels', l.id);
      }
      await delWhere(tx, 'statuses', 'projectId', a.id);
      await tx.del('projects', a.id);
    },
  }),
];
