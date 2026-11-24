import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type EntityName,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';
import { branchTemplateError, BRANCH_NAME_MAX } from './branch-name.js';

export * from './branch-name.js';

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
  /**
   * PLNRAPP-205: status of the MR's head pipeline while it is open; after the merge — of the target branch
   * pipeline with the merge (deploy), `skipped` — none came. null — not known yet.
   * default: replica rows cached before the column
   */
  pipelineStatus: z.string().max(40).nullable().default(null),
  /** PLNRAPP-822: the job of that pipeline in GitLab (the pipeline page if it has no jobs); null — unknown */
  pipelineUrl: z.string().max(2000).nullable().default(null),
  createdAt: ts,
  updatedAt: ts,
});
export const gitlabProjectSettings = z.object({
  id,
  spaceId: id,
  mergedStatusId: id.nullable(),
  /** PLNRAPP-153: branch name template; null — `{TASK_KEY}`. default: replica rows cached before the column */
  branchTemplate: z.string().max(200).nullable().default(null),
  updatedAt: ts,
});
/** PLNRAPP-153: a branch created from the task's GitLab tab (MRs are grouped under it by sourceBranch). */
export const gitlabBranches = z.object({
  id,
  spaceId: id,
  taskId: id,
  gitlabProjectId: z.number().int(),
  name: z.string().min(1).max(BRANCH_NAME_MAX),
  webUrl: z.string(),
  /** PLNRAPP-822: id of the branch's last pipeline. default: replica rows cached before the column */
  pipelineId: z.number().int().nullable().default(null),
  /** PLNRAPP-822: status of the branch's last pipeline; null — none yet. default: replica rows cached before the column */
  pipelineStatus: z.string().max(40).nullable().default(null),
  /** PLNRAPP-822: its job in GitLab (the pipeline page if it has no jobs) */
  pipelineUrl: z.string().max(2000).nullable().default(null),
  createdAt: ts,
  updatedAt: ts,
});
export type GitlabMr = z.output<typeof gitlabMrs>;
export type GitlabBranch = z.output<typeof gitlabBranches>;
type Settings = z.output<typeof gitlabProjectSettings>;

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
      mr: gitlabMrs
        .pick({
          title: true,
          sourceBranch: true,
          state: true,
          authorName: true,
          webUrl: true,
          mrUpdatedAt: true,
        })
        .extend({
          // absent — not fetched in this poll: kept, but reset when the MR changes its state
          pipelineStatus: z.string().max(40).nullable().optional(),
          // PLNRAPP-822: the job of that pipeline; follows pipelineStatus (absent — kept with it)
          pipelineUrl: z.string().max(2000).nullable().optional(),
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
        const pipelineStatus =
          a.mr.pipelineStatus !== undefined
            ? a.mr.pipelineStatus
            : prev && prev.state === a.mr.state
              ? (prev.pipelineStatus ?? null)
              : null;
        const pipelineUrl =
          a.mr.pipelineStatus !== undefined
            ? (a.mr.pipelineUrl ?? null)
            : prev && prev.state === a.mr.state
              ? (prev.pipelineUrl ?? null)
              : null;
        const row = { ...a.mr, title: a.mr.title.slice(0, 500), pipelineStatus, pipelineUrl };
        const same =
          prev &&
          prev.title === row.title &&
          prev.sourceBranch === row.sourceBranch &&
          prev.state === row.state &&
          prev.authorName === row.authorName &&
          prev.webUrl === row.webUrl &&
          (prev.pipelineStatus ?? null) === row.pipelineStatus &&
          (prev.pipelineUrl ?? null) === row.pipelineUrl &&
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
        if (!status || status.projectId !== task.projectId) continue;
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
        if (!s || s.projectId !== p.id)
          throw new MutatorError('invalid_args', 'statusId другого проекта');
      }
      const old = (await mtx(tx).get(E('gitlabProjectSettings'), p.id)) as Settings | undefined;
      await mtx(tx).put(E('gitlabProjectSettings'), {
        id: p.id,
        spaceId: p.spaceId,
        mergedStatusId: a.statusId,
        branchTemplate: old?.branchTemplate ?? null,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'gitlab.setBranchTemplate',
    // null — the default {TASK_KEY}; REST PUT /api/gitlab/projects/:id/branch-template calls it as system for a non-guest
    args: z.object({ projectId: id, template: z.string().max(200).nullable() }),
    async run(tx, a, ctx) {
      const p = await tx.get('projects', a.projectId);
      if (!p) throw new MutatorError('not_found', `projects ${a.projectId}`);
      const err = a.template === null ? null : branchTemplateError(a.template);
      if (err) throw new MutatorError('invalid_args', err);
      const old = (await mtx(tx).get(E('gitlabProjectSettings'), p.id)) as Settings | undefined;
      await mtx(tx).put(E('gitlabProjectSettings'), {
        id: p.id,
        spaceId: p.spaceId,
        mergedStatusId: old?.mergedStatusId ?? null,
        branchTemplate: a.template,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'gitlab.branch.link',
    // writing to gitlabBranches (write: server) — only system; the same (task, repository, name) again — kept
    args: z.object({
      id,
      taskId: id,
      gitlabProjectId: z.number().int(),
      name: gitlabBranches.shape.name,
      webUrl: z.string(),
    }),
    async run(tx, a, ctx) {
      const task = await tx.get('tasks', a.taskId);
      if (!task) throw new MutatorError('not_found', `tasks ${a.taskId}`);
      const rows = (await mtx(tx).scan(E('gitlabBranches'), {
        index: 'taskId',
        eq: a.taskId,
      })) as GitlabBranch[];
      if (rows.some((r) => r.gitlabProjectId === a.gitlabProjectId && r.name === a.name)) return;
      await mtx(tx).put(E('gitlabBranches'), {
        id: a.id,
        spaceId: task.spaceId,
        taskId: a.taskId,
        gitlabProjectId: a.gitlabProjectId,
        name: a.name,
        webUrl: a.webUrl,
        pipelineId: null,
        pipelineStatus: null,
        pipelineUrl: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'gitlab.branch.ci',
    // PLNRAPP-822: the branch's last pipeline from the poll (system only); unchanged — nothing
    args: z.object({
      id,
      pipelineId: z.number().int().nullable(),
      pipelineStatus: z.string().max(40).nullable(),
      pipelineUrl: z.string().max(2000).nullable(),
    }),
    async run(tx, a, ctx) {
      const b = (await mtx(tx).get(E('gitlabBranches'), a.id)) as GitlabBranch | undefined;
      if (!b) return;
      if (
        (b.pipelineId ?? null) === a.pipelineId &&
        (b.pipelineStatus ?? null) === a.pipelineStatus &&
        (b.pipelineUrl ?? null) === a.pipelineUrl
      )
        return;
      await mtx(tx).patch(E('gitlabBranches'), a.id, {
        pipelineId: a.pipelineId,
        pipelineStatus: a.pipelineStatus,
        pipelineUrl: a.pipelineUrl,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'gitlab.branch.dropRepo',
    // the connection is removed: branches of its repository on the tasks of its project go too (system only)
    args: z.object({ projectId: id, gitlabProjectId: z.number().int() }),
    async run(tx, a) {
      const t = mtx(tx);
      for (const r of (await t.scan(E('gitlabBranches'))) as GitlabBranch[])
        if (
          r.gitlabProjectId === a.gitlabProjectId &&
          (await tx.get('tasks', r.taskId))?.projectId === a.projectId
        )
          await t.del(E('gitlabBranches'), r.id);
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
    gitlabBranches: {
      schema: gitlabBranches,
      meta: { scope: 'space', write: 'server', bootstrap: true, indexes: ['taskId'] },
    },
    gitlabProjectSettings: {
      schema: gitlabProjectSettings,
      meta: { scope: 'space', write: 'admin', bootstrap: true, indexes: ['spaceId'] },
    },
  },
};
