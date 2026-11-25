import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  needProjectAdmin,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const uuid = z.uuid();
const bad = (m: string) => new MutatorError('invalid_args', m);

/**
 * `field:` without an id and an empty id in an action are placeholders of an imported rule (PLNRAPP export/import):
 * such a rule is stored only disabled (see `isIncomplete`), the person fills them in.
 */
export const EMPTY_FIELD_REF = 'field:';
const fieldRef = z.templateLiteral(['field:', z.uuid()]);
const fieldRefOrEmpty = z.union([fieldRef, z.literal(EMPTY_FIELD_REF)]);
const refId = z.union([uuid, z.literal('')]);

export const TRIGGER_TYPES = [
  'task.created',
  'task.status_changed',
  'task.assignee_changed',
  'task.field_changed',
  'task.due',
  'comment.added',
  'task.stale',
  'task.unassigned',
  'task.waiting_human',
  'task.start_reached',
  'task.subtasks_closed',
  'mr.pipeline',
  'schedule',
] as const;

/**
 * PLNRAPP-205: pipeline statuses of a task's MR (module gitlab): of the MR's head pipeline while it is open,
 * of the target branch pipeline (deploy) after the merge; `skipped` — no pipeline came after the merge.
 */
export const PIPELINE_STATUSES = ['success', 'failed', 'canceled', 'skipped', 'manual'] as const;

/** Five cron fields: `*`, numbers, ranges, steps, lists; bounds are checked by the api parser. */
const CRON_FIELD = String.raw`(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*`;
export const CRON_RE = new RegExp(`^${CRON_FIELD}( ${CRON_FIELD}){4}$`);

export const isTimeZone = (v: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};
const days = z.number().int().min(1).max(365);
const byHuman = z.boolean().optional();

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.created') }),
  z.object({
    type: z.literal('task.status_changed'),
    from: z.array(uuid).optional(),
    to: z.array(uuid).optional(),
  }),
  z.object({
    type: z.literal('task.assignee_changed'),
    /** fires when one of these users is added; empty — any change */
    userIds: z.array(uuid).optional(),
    /** rules saved before PLNRAPP-197: a single user */
    userId: uuid.optional(),
    /** PLNRAPP-539: false — not when the assignee comes with the new task (the harness twins of status rules) */
    onCreate: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('task.field_changed'),
    field: z.union([
      z.enum(['title', 'description', 'priority', 'dueDate', 'startDate', 'parentId']),
      fieldRefOrEmpty,
    ]),
    byHuman,
  }),
  z.object({ type: z.literal('task.due'), daysBefore: z.number().int().min(0).max(30) }),
  z.object({ type: z.literal('comment.added'), byHuman }),
  z.object({ type: z.literal('task.stale'), days, statuses: z.array(uuid).optional() }),
  z.object({ type: z.literal('task.unassigned'), hours: z.number().int().min(1).max(720) }),
  z.object({ type: z.literal('task.waiting_human'), days }),
  z.object({ type: z.literal('task.start_reached') }),
  // PLNRAPP-773: the last open subtask is done or cancelled — once per closing
  z.object({ type: z.literal('task.subtasks_closed') }),
  // PLNRAPP-205: the pipeline of the task's MR came to a status; opened — CI of the MR, merged — deploy
  z.object({
    type: z.literal('mr.pipeline'),
    mr: z.enum(['opened', 'merged']),
    pipeline: z.array(z.enum(PIPELINE_STATUSES)).min(1),
  }),
  z.object({
    type: z.literal('schedule'),
    cron: z.string().regex(CRON_RE),
    tz: z.string().refine(isTimeZone).optional(),
  }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

const filterField = z.union([
  z.enum([
    'status',
    'statusCategory',
    'assignee',
    'priority',
    'label',
    'dueDate',
    'title',
    'text',
    'createdBy',
    'cycle',
  ]),
  fieldRef,
]);
export const filterSchema = z.object({
  op: z.enum(['and', 'or']),
  rules: z.array(
    z.object({
      field: filterField,
      operator: z.enum([
        'in',
        'notIn',
        'isEmpty',
        'isNotEmpty',
        'before',
        'after',
        'contains',
        'gte',
        'lte',
      ]),
      value: z.union([z.array(z.string()), z.array(z.number()), z.string(), z.number()]).optional(),
    }),
  ),
});

/** `YYYY-MM-DD` or `today`, `today+N`, `today-N`. */
const DATE_EXPR = /^(\d{4}-\d{2}-\d{2}|today([+-]\d+)?)$/;

const setField = z
  .object({
    type: z.literal('set_field'),
    field: z.union([z.enum(['priority', 'dueDate', 'startDate']), fieldRefOrEmpty]),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .superRefine((a, c) => {
    const ok =
      a.field === 'priority'
        ? typeof a.value === 'number' && Number.isInteger(a.value) && a.value >= 0 && a.value <= 4
        : a.field === 'dueDate' || a.field === 'startDate'
          ? a.value === null || (typeof a.value === 'string' && DATE_EXPR.test(a.value))
          : true;
    if (!ok) c.addIssue({ code: 'custom', message: `value для ${a.field}`, path: ['value'] });
  });

export const actionSchema = z.union([
  z.object({ type: z.literal('set_status'), statusId: refId }),
  z.object({ type: z.literal('assign'), userId: refId }),
  z.object({ type: z.literal('unassign'), userId: refId }),
  z.object({ type: z.literal('add_label'), labelId: refId }),
  z.object({ type: z.literal('remove_label'), labelId: refId }),
  setField,
  z.object({ type: z.literal('add_comment'), text: z.string().min(1).max(5000) }),
  z.object({ type: z.literal('move_to_project'), projectId: refId, statusId: uuid.optional() }),
  z.object({ type: z.literal('create_subtask'), title: z.string().min(1).max(500) }),
  z.object({ type: z.literal('send_webhook'), subscriptionId: refId }),
  // module ai (PLNRAPP-168): a run of the project's AI action over the task, after a 60 s debounce
  // maxRuns (PLNRAPP-205): runs by this rule in a row on a task; past it — a question to a person
  z.object({
    type: z.literal('ai_run'),
    aiActionId: refId,
    maxRuns: z.number().int().min(1).max(20).optional(),
  }),
  // PLNRAPP-204: on comment.added — closes the comment the new one replies to, if its assignee replied
  z.object({ type: z.literal('resolve_comment') }),
]);
export type Action = z.infer<typeof actionSchema>;

/**
 * A rule that runs AI is created, changed and deleted only by an admin of the project;
 * its AI actions are of the rule's project (the last list — the new actions).
 */
async function checkAi(
  tx: Tx,
  userId: string,
  r: Pick<Rule, 'spaceId' | 'projectId'>,
  ...lists: Action[][]
) {
  if (!lists.some((l) => l.some((a) => a.type === 'ai_run'))) return;
  await needProjectAdmin(tx, r.spaceId, r.projectId, userId);
  for (const a of lists.at(-1)!)
    if (
      a.type === 'ai_run' &&
      a.aiActionId !== '' &&
      (await m(tx).get<{ projectId: string }>('aiActions', a.aiActionId))?.projectId !== r.projectId
    )
      throw bad(`ИИ-действие ${a.aiActionId} не найдено в проекте`);
}

/** move_to_project runs as the system: the target must be a visible project of the rule's own space, or a rule moves tasks where its author has no rights */
async function checkMoves(tx: Tx, r: Pick<Rule, 'spaceId'>, list: Action[]) {
  for (const a of list)
    if (
      a.type === 'move_to_project' &&
      a.projectId !== '' &&
      (await tx.get('projects', a.projectId))?.spaceId !== r.spaceId
    )
      throw bad(`Проект ${a.projectId} не найден в пространстве правила`);
}

/** A rule with placeholders (an unbound import) must not run: only disabled ones may hold them. */
export const isIncomplete = (r: Pick<Rule, 'trigger' | 'actions'>): boolean =>
  (r.trigger.type === 'task.field_changed' && r.trigger.field === EMPTY_FIELD_REF) ||
  r.actions.some((a) =>
    Object.entries(a).some(
      ([k, v]) => (k.endsWith('Id') && v === '') || (k === 'field' && v === EMPTY_FIELD_REF),
    ),
  );
const needComplete = (r: Pick<Rule, 'trigger' | 'actions' | 'enabled'>) => {
  if (r.enabled && isIncomplete(r))
    throw bad('Правило не заполнено — его можно только выключенным');
};

const actions = z.array(actionSchema).min(1).max(10);
const name = z.string().min(1).max(100);
const description = z.string().max(2000).nullable();

export const automationsRules = z.object({
  id: uuid,
  spaceId: uuid,
  projectId: uuid,
  name,
  // default: replica rows cached before the column
  description: description.default(null),
  enabled: z.boolean(),
  trigger: triggerSchema,
  conditions: filterSchema,
  actions,
  createdBy: uuid,
  createdAt: ts,
  updatedAt: ts,
});
export type Rule = z.infer<typeof automationsRules>;

export interface Run {
  id: string;
  ruleId: string;
  taskId: string;
  depth: number;
  status: 'ok' | 'skipped' | 'error';
  error: string | null;
  createdAt: string;
}

// automations conditions: the filter language without the client-side `aiStatus` (PLNRAPP-663)
export const EMPTY_FILTER: z.infer<typeof filterSchema> = { op: 'and', rules: [] };

// Tx is typed with core entities; module entities are cast (C-modules)
interface ModTx {
  get<T>(e: string, id: string): Promise<T | undefined>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
}
const m = (tx: Tx) => tx as unknown as ModTx;

async function needRule(tx: Tx, id: string): Promise<Rule> {
  const r = await m(tx).get<Rule>('automationsRules', id);
  if (!r) throw new MutatorError('not_found', `automationsRules ${id}`);
  return r;
}

export const create = defineMutator({
  name: 'automations.create',
  args: z.object({
    id: uuid,
    projectId: uuid,
    name,
    description: description.optional(),
    trigger: triggerSchema,
    conditions: filterSchema.optional(),
    actions,
    enabled: z.boolean().optional(),
  }),
  async run(tx, a, ctx) {
    const project = await tx.get('projects', a.projectId);
    if (!project) throw new MutatorError('not_found', `project ${a.projectId}`);
    await checkAi(tx, ctx.userId, { spaceId: project.spaceId, projectId: a.projectId }, a.actions);
    await checkMoves(tx, project, a.actions);
    needComplete({ trigger: a.trigger, actions: a.actions, enabled: a.enabled ?? true });
    const row: Rule = {
      id: a.id,
      spaceId: project.spaceId,
      projectId: a.projectId,
      name: a.name,
      description: a.description ?? null,
      enabled: a.enabled ?? true,
      trigger: a.trigger,
      conditions: a.conditions ?? EMPTY_FILTER,
      actions: a.actions,
      createdBy: ctx.userId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    await m(tx).put('automationsRules', row);
  },
});

export const update = defineMutator({
  name: 'automations.update',
  args: z.object({
    id: uuid,
    name: name.optional(),
    description: description.optional(),
    trigger: triggerSchema.optional(),
    conditions: filterSchema.optional(),
    actions: actions.optional(),
    enabled: z.boolean().optional(),
  }),
  async run(tx, { id, ...a }, ctx) {
    const old = await needRule(tx, id);
    const patch = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length) throw bad('нечего менять');
    await checkAi(tx, ctx.userId, old, old.actions, a.actions ?? []);
    await checkMoves(tx, old, a.actions ?? []);
    needComplete({ ...old, ...patch });
    await m(tx).patch('automationsRules', id, { ...patch, updatedAt: ctx.now });
  },
});

export const del = defineMutator({
  name: 'automations.delete',
  args: z.object({ id: uuid }),
  async run(tx, a, ctx) {
    const old = await needRule(tx, a.id);
    await checkAi(tx, ctx.userId, old, old.actions);
    await m(tx).del('automationsRules', a.id);
  },
});

export const shared: SharedModuleManifest = {
  id: 'automations',
  mutators: [create, update, del],
  entities: {
    automationsRules: {
      schema: automationsRules,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId', 'projectId'] },
    },
  },
};
