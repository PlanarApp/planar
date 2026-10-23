import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  type Filter,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const uuid = z.uuid();
const bad = (m: string) => new MutatorError('invalid_args', m);

const fieldRef = z.templateLiteral(['field:', z.uuid()]);

export const TRIGGER_TYPES = [
  'task.created',
  'task.status_changed',
  'task.assignee_changed',
  'task.field_changed',
  'task.due',
  'comment.added',
] as const;

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.created') }),
  z.object({
    type: z.literal('task.status_changed'),
    from: z.array(uuid).optional(),
    to: z.array(uuid).optional(),
  }),
  z.object({ type: z.literal('task.assignee_changed'), userId: uuid.optional() }),
  z.object({
    type: z.literal('task.field_changed'),
    field: z.union([
      z.enum(['title', 'description', 'priority', 'dueDate', 'startDate', 'parentId']),
      fieldRef,
    ]),
  }),
  z.object({ type: z.literal('task.due'), daysBefore: z.number().int().min(0).max(30) }),
  z.object({ type: z.literal('comment.added') }),
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

/** `YYYY-MM-DD` или `today`, `today+N`, `today-N`. */
const DATE_EXPR = /^(\d{4}-\d{2}-\d{2}|today([+-]\d+)?)$/;

const setField = z
  .object({
    type: z.literal('set_field'),
    field: z.union([z.enum(['priority', 'dueDate', 'startDate']), fieldRef]),
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
  z.object({ type: z.literal('set_status'), statusId: uuid }),
  z.object({ type: z.literal('assign'), userId: uuid }),
  z.object({ type: z.literal('unassign'), userId: uuid }),
  z.object({ type: z.literal('add_label'), labelId: uuid }),
  z.object({ type: z.literal('remove_label'), labelId: uuid }),
  setField,
  z.object({ type: z.literal('add_comment'), text: z.string().min(1).max(5000) }),
  z.object({ type: z.literal('move_to_project'), projectId: uuid, statusId: uuid.optional() }),
  z.object({ type: z.literal('create_subtask'), title: z.string().min(1).max(500) }),
  z.object({ type: z.literal('send_webhook'), subscriptionId: uuid }),
]);
export type Action = z.infer<typeof actionSchema>;

const actions = z.array(actionSchema).min(1).max(10);
const name = z.string().min(1).max(100);

export const automationsRules = z.object({
  id: uuid,
  spaceId: uuid,
  projectId: uuid,
  name,
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

export const EMPTY_FILTER: Filter = { op: 'and', rules: [] };

// Tx типизирован сущностями ядра; сущности модуля приводим (C-modules)
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
    trigger: triggerSchema,
    conditions: filterSchema.optional(),
    actions,
    enabled: z.boolean().optional(),
  }),
  async run(tx, a, ctx) {
    const project = await tx.get('projects', a.projectId);
    if (!project) throw new MutatorError('not_found', `project ${a.projectId}`);
    const row: Rule = {
      id: a.id,
      spaceId: project.spaceId,
      projectId: a.projectId,
      name: a.name,
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
    trigger: triggerSchema.optional(),
    conditions: filterSchema.optional(),
    actions: actions.optional(),
    enabled: z.boolean().optional(),
  }),
  async run(tx, { id, ...a }, ctx) {
    await needRule(tx, id);
    const patch = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length) throw bad('нечего менять');
    await m(tx).patch('automationsRules', id, { ...patch, updatedAt: ctx.now });
  },
});

export const del = defineMutator({
  name: 'automations.delete',
  args: z.object({ id: uuid }),
  async run(tx, a) {
    await needRule(tx, a.id);
    await m(tx).del('automationsRules', a.id);
  },
});

/** Маркер конца действий правила: afterMutation ставит доставку webhook в той же транзакции. */
export const fire = defineMutator({
  name: 'automations.fire',
  args: z.object({ ruleId: uuid }),
  async run() {},
});

export const shared: SharedModuleManifest = {
  id: 'automations',
  mutators: [create, update, del, fire],
  entities: {
    automationsRules: {
      schema: automationsRules,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId', 'projectId'] },
    },
  },
};
