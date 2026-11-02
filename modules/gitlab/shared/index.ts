import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type EntityName,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const id = z.uuid();

export const gitlabMrs = z.object({
  id,
  spaceId: id,
  taskId: id,
  gitlabProjectId: z.number().int(),
  iid: z.number().int(),
  title: z.string().max(500),
  sourceBranch: z.string(),
  state: z.enum(['opened', 'closed', 'locked', 'merged']),
  authorName: z.string(),
  webUrl: z.string(),
  mrUpdatedAt: ts,
  createdAt: ts,
  updatedAt: ts,
});
export const gitlabProjectSettings = z.object({
  id,
  spaceId: id,
  mergedStatusId: id.nullable(),
  updatedAt: ts,
});
export type GitlabMr = z.output<typeof gitlabMrs>;

// Tx is typed with core entities; module entities are cast (C-modules)
interface MTx {
  get(e: string, id: string): Promise<unknown>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan(e: string, o?: { index: string; eq: unknown }): Promise<unknown[]>;
}
const mtx = (tx: Tx) => tx as unknown as MTx;
const E = (n: string) => n as EntityName;

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

export const mutators = [
  defineMutator({
    name: 'gitlab.mr.sync',
    args: z.object({
      // Planar project of the connection: only its tasks are linked and unlinked
      projectId: id,
      gitlabProjectId: z.number().int(),
      iid: z.number().int(),
      mr: gitlabMrs.pick({
        title: true,
        sourceBranch: true,
        state: true,
        authorName: true,
        webUrl: true,
        mrUpdatedAt: true,
      }),
      links: z.array(z.object({ id, taskId: id })).max(50),
    }),
    // writing to gitlabMrs (write: server) is available only to system; for the client — forbidden
    async run(tx, a, ctx) {
      const t = mtx(tx);
      // shortcut: a full table scan — there is no (project, iid) index in the contract; revisit when it grows beyond 10k rows
      // — add a gitlabProjectId index via the contract
      const old: GitlabMr[] = [];
      for (const r of (await t.scan(E('gitlabMrs'))) as GitlabMr[])
        if (
          r.gitlabProjectId === a.gitlabProjectId &&
          r.iid === a.iid &&
          (await tx.get('tasks', r.taskId))?.projectId === a.projectId
        )
          old.push(r);
      const keep = new Set(a.links.map((l) => l.taskId));
      for (const r of old) if (!keep.has(r.taskId)) await t.del(E('gitlabMrs'), r.id);
      for (const l of a.links) {
        const task = await tx.get('tasks', l.taskId);
        if (!task || task.projectId !== a.projectId) continue;
        const prev = old.find((r) => r.taskId === l.taskId);
        const row = { ...a.mr, title: a.mr.title.slice(0, 500) };
        const same =
          prev &&
          prev.title === row.title &&
          prev.sourceBranch === row.sourceBranch &&
          prev.state === row.state &&
          prev.authorName === row.authorName &&
          prev.webUrl === row.webUrl &&
          sameInstant(prev.mrUpdatedAt, row.mrUpdatedAt);
        if (!same)
          await t.put(E('gitlabMrs'), {
            id: prev?.id ?? l.id,
            spaceId: task.spaceId,
            taskId: l.taskId,
            gitlabProjectId: a.gitlabProjectId,
            iid: a.iid,
            ...row,
            createdAt: prev?.createdAt ?? ctx.now,
            updatedAt: ctx.now,
          });
        if (row.state !== 'merged' || prev?.state === 'merged') continue;
        const st = (await t.get(E('gitlabProjectSettings'), task.projectId)) as
          { mergedStatusId: string | null } | undefined;
        if (!st?.mergedStatusId || st.mergedStatusId === task.statusId) continue;
        // same as task.update {statusId}: completedAt by status category
        const status = await tx.get('statuses', st.mergedStatusId);
        if (!status || status.spaceId !== task.spaceId) continue;
        const done = status.category === 'done' || status.category === 'cancelled';
        await tx.patch('tasks', task.id, {
          statusId: status.id,
          completedAt: done ? (task.completedAt ?? ctx.now) : null,
          updatedAt: ctx.now,
        });
      }
    },
  }),
  defineMutator({
    name: 'gitlab.setMergedStatus',
    args: z.object({ projectId: id, statusId: id.nullable() }),
    async run(tx, a, ctx) {
      const p = await tx.get('projects', a.projectId);
      if (!p) throw new MutatorError('not_found', `projects ${a.projectId}`);
      if (a.statusId) {
        const s = await tx.get('statuses', a.statusId);
        if (!s || s.spaceId !== p.spaceId)
          throw new MutatorError('invalid_args', 'statusId другого пространства');
      }
      await mtx(tx).put(E('gitlabProjectSettings'), {
        id: p.id,
        spaceId: p.spaceId,
        mergedStatusId: a.statusId,
        updatedAt: ctx.now,
      });
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'gitlab',
  mutators,
  entities: {
    gitlabMrs: {
      schema: gitlabMrs,
      meta: { scope: 'space', write: 'server', bootstrap: true, indexes: ['taskId'] },
    },
    gitlabProjectSettings: {
      schema: gitlabProjectSettings,
      meta: { scope: 'space', write: 'admin', bootstrap: true, indexes: ['spaceId'] },
    },
  },
};
