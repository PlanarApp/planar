import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  needProjectAdmin,
  type EntityName,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

/** The bot user: login and display name (PLNRAPP-167). */
export const AI_BOT_LOGIN = 'ai';
export const AI_BOT_NAME = 'ИИ';

export const AI_PROVIDERS = ['openai', 'anthropic', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_SCOPES = ['instance', 'space', 'project'] as const;
export type AiScope = (typeof AI_SCOPES)[number];
/** scopeId of the instance level (the column is not null: one connection per level) */
export const INSTANCE_SCOPE_ID = '00000000-0000-0000-0000-000000000000';

/** Connection as the client sees it: the key is never returned, only whether it is set. */
export interface AiConnectionView {
  id: string;
  scope: AiScope;
  scopeId: string;
  provider: AiProvider;
  baseUrl: string | null;
  model: string;
  /** USD per 1M tokens; null — unknown, cost is not counted */
  priceIn: number | null;
  priceOut: number | null;
  keySet: true;
  updatedAt: string;
}

const ts = z.iso.datetime();
const uuid = z.uuid();

export const AI_RUNTIMES = ['llm', 'agent'] as const;
export const AI_ACTION_KEY_RE = /^[a-z][a-z0-9_-]{0,49}$/;

/**
 * An AI action of a project (PLNRAPP-168): what a rule `ai_run` runs. The prompt is not stored here — it is
 * the text of the docs page `pageId`, read at the moment of the run.
 */
export const aiActions = z.object({
  id: uuid,
  spaceId: uuid,
  projectId: uuid,
  key: z.string().regex(AI_ACTION_KEY_RE),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable(),
  pageId: uuid.nullable(),
  runtime: z.enum(AI_RUNTIMES),
  /** overrides the model of the connection in force */
  model: z.string().min(1).max(200).nullable(),
  /** «Уточнение»: where a task goes while the AI waits for an answer; null — the status is not changed */
  questionStatusId: uuid.nullable(),
  /** readiness criteria (as in `dpcli accept`): go into the prompt */
  checks: z.array(z.string().min(1).max(500)).max(20),
  maxOutputTokens: z.number().int().min(100).max(64_000).nullable(),
  createdAt: ts,
  updatedAt: ts,
});
export type AiAction = z.infer<typeof aiActions>;

// Tx is typed with core entities; module entities are cast (C-modules)
interface MTx {
  get(e: string, id: string): Promise<unknown>;
  scan(e: string, o: { index: string; eq: unknown }): Promise<unknown[]>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
}
const mtx = (tx: Tx) => tx as unknown as MTx;
const E = 'aiActions' as EntityName;
const bad = (m: string) => new MutatorError('invalid_args', m);

async function need(tx: Tx, id: string) {
  const a = (await mtx(tx).get(E, id)) as AiAction | undefined;
  if (!a) throw new MutatorError('not_found', `aiActions ${id}`);
  return a;
}

/** key is unique in the project; the status and the page — of this project. */
async function check(tx: Tx, a: Pick<AiAction, 'id' | 'projectId'> & Partial<AiAction>) {
  if (a.key !== undefined) {
    const same = (await mtx(tx).scan(E, { index: 'projectId', eq: a.projectId })) as AiAction[];
    if (same.some((x) => x.key === a.key && x.id !== a.id)) throw bad(`key ${a.key} уже есть`);
  }
  if (a.questionStatusId) {
    const s = await tx.get('statuses', a.questionStatusId);
    if (s?.projectId !== a.projectId) throw bad('questionStatusId другого проекта');
  }
  if (a.pageId) {
    const p = (await mtx(tx).get('docsPages', a.pageId)) as
      { projectId: string | null } | undefined;
    if (p?.projectId !== a.projectId) throw bad('pageId: страница другого проекта');
  }
}

const fields = {
  description: aiActions.shape.description.optional(),
  pageId: aiActions.shape.pageId.optional(),
  runtime: aiActions.shape.runtime.optional(),
  model: aiActions.shape.model.optional(),
  questionStatusId: aiActions.shape.questionStatusId.optional(),
  checks: aiActions.shape.checks.optional(),
  maxOutputTokens: aiActions.shape.maxOutputTokens.optional(),
};

export const mutators = [
  defineMutator({
    name: 'ai.action.create',
    args: z.object({
      id: uuid,
      projectId: uuid,
      key: aiActions.shape.key,
      name: aiActions.shape.name,
      ...fields,
    }),
    async run(tx, a, ctx) {
      const project = await tx.get('projects', a.projectId);
      if (!project) throw new MutatorError('not_found', `project ${a.projectId}`);
      await needProjectAdmin(tx, project.spaceId, a.projectId, ctx.userId);
      await check(tx, a);
      const row: AiAction = {
        id: a.id,
        spaceId: project.spaceId,
        projectId: a.projectId,
        key: a.key,
        name: a.name,
        description: a.description ?? null,
        pageId: a.pageId ?? null,
        runtime: a.runtime ?? 'llm',
        model: a.model ?? null,
        questionStatusId: a.questionStatusId ?? null,
        checks: a.checks ?? [],
        maxOutputTokens: a.maxOutputTokens ?? null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      };
      await mtx(tx).put(E, row);
    },
  }),
  defineMutator({
    name: 'ai.action.update',
    args: z.object({
      id: uuid,
      key: aiActions.shape.key.optional(),
      name: aiActions.shape.name.optional(),
      ...fields,
    }),
    async run(tx, { id, ...a }, ctx) {
      const old = await need(tx, id);
      await needProjectAdmin(tx, old.spaceId, old.projectId, ctx.userId);
      const patch = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) throw bad('нечего менять');
      await check(tx, { id, projectId: old.projectId, ...patch });
      await mtx(tx).patch(E, id, { ...patch, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'ai.action.delete',
    args: z.object({ id: uuid }),
    async run(tx, a, ctx) {
      const old = await need(tx, a.id);
      await needProjectAdmin(tx, old.spaceId, old.projectId, ctx.userId);
      await mtx(tx).del(E, a.id);
    },
  }),
];

// Connections and runs are server tables outside the module gate (ai_connections, ai_runs).
export const shared: SharedModuleManifest = {
  id: 'ai',
  mutators,
  entities: {
    aiActions: {
      schema: aiActions,
      meta: { scope: 'space', write: 'admin', bootstrap: true, indexes: ['spaceId', 'projectId'] },
    },
  },
};

export * from './harness.js';
