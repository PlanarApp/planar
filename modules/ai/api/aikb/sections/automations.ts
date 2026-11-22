import { actionSchema, filterSchema, triggerSchema } from '@planar/module-automations/shared';

/** Meaning of each trigger / action type; a type without an entry renders as NO_DESC and fails the aikb-automations test. */
export const NO_DESC = '(no description)';
const TRIGGER_DOC: Record<string, string> = {
  'task.created': 'a task is created',
  'task.status_changed': 'status changes; from/to = status ids, empty = any',
  'task.assignee_changed':
    'an assignee is added; userIds empty = any change (userId is legacy); onCreate: false — not for the assignees of a task being created',
  'task.field_changed':
    'a task field changes (built-in name or field:<fieldDefId>); byHuman = only by a person, not a rule/AI',
  'task.due': 'daysBefore days before the due date',
  'comment.added': 'a comment is added; byHuman = only by a person',
  'task.stale': 'no activity for `days` days; statuses = limit to these status ids',
  'task.unassigned': 'task has had no assignee for `hours` hours',
  'task.waiting_human': 'an AI run waits for a person for `days` days',
  'task.start_reached': 'the task start date is reached',
  'task.subtasks_closed':
    'the last open subtask of the task became done or cancelled; fires once per closing (checked every minute)',
  'mr.pipeline':
    'pipeline of the task MR reached a status: mr=opened is the MR CI, mr=merged is the deploy (module gitlab)',
  schedule: 'cron (5 fields, UTC unless tz = IANA zone); fires for matching tasks of the project',
};
const ACTION_DOC: Record<string, string> = {
  set_status: 'move the task to a status',
  assign: 'add an assignee',
  unassign: 'remove an assignee',
  add_label: 'attach a label',
  remove_label: 'detach a label',
  set_field:
    'priority is integer 0-4; dueDate/startDate are null, YYYY-MM-DD or today, today+N, today-N; field:<id> takes any scalar',
  add_comment: 'post a comment (1-5000 chars)',
  move_to_project: 'move the task to another project, optionally to statusId',
  create_subtask: 'create a subtask with this title',
  send_webhook: 'call a webhook subscription',
  ai_run:
    'run a project AI action over the task (10 s debounce); maxRuns 1-20 = runs in a row, past it a question to a person; the rule can be created/changed/deleted only by a project admin',
  resolve_comment:
    'on comment.added: close the comment this one replies to, if its assignee replied',
};

// Minimal structural view of a zod type (zod 4 `def`); no zod import so the module-ai build stays decoupled.
type Z = {
  def: { type: string; format?: string; innerType?: Z; element?: Z; options?: unknown[] };
  safeParse(x: unknown): { success: boolean };
};
const ty = (z: Z): string => {
  const d = z.def;
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
      return ty(d.innerType!);
    case 'pipe':
      return 'value';
    case 'enum':
      return Object.values((z as unknown as { enum: object }).enum).join('|');
    case 'union':
      return [...new Set((d.options as Z[]).map(ty))].join(' | ');
    case 'array':
      return `[${ty(d.element!)}]`;
    case 'template_literal':
      return 'field:<fieldDefId>';
    case 'string':
      return d.format === 'uuid' ? 'uuid' : 'string';
    default:
      return d.type;
  }
};
const params = (shape: Record<string, Z>) =>
  Object.entries(shape)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}${v.safeParse(undefined).success ? '' : '*'}: ${ty(v)}`)
    .join(', ');
const shapeOf = (o: unknown) => (o as { shape: Record<string, Z> }).shape;
const typeOf = (o: unknown) =>
  (shapeOf(o).type as unknown as { def: { values: string[] } }).def.values[0]!;
const lines = (opts: unknown[], doc: Record<string, string>) =>
  opts.map((o) => {
    const t = typeOf(o);
    const p = params(shapeOf(o));
    return `- ${t}${p ? ` (${p})` : ''} — ${doc[t] ?? NO_DESC}`;
  });

const filterRule = shapeOf(
  (shapeOf(filterSchema).rules as unknown as { def: { element: unknown } }).def.element,
);

export const section = {
  id: 'automations',
  title: 'Automation rules: triggers, conditions, actions',
  body: [
    'An automation rule belongs to a project: name, description, enabled, trigger (one), conditions (filter, optional), actions (1-10, run in order). A rule fires on the trigger for a task, runs only if the conditions match the task, then runs the actions. Parameters: * = required.',
    '',
    'Triggers (trigger.type):',
    ...lines((triggerSchema as unknown as { options: unknown[] }).options, TRIGGER_DOC),
    'cron format: five fields; `*`, numbers, ranges a-b, steps /n, lists a,b.',
    '',
    `Conditions: {op: ${ty(filterSchema.shape.op as unknown as Z)}, rules: [{ ${params(filterRule)} }]}. Empty rules = always matches. Rule fields: field = a built-in name or field:<fieldDefId>; operator isEmpty/isNotEmpty take no value; dueDate takes before/after; value is a string/number or an array of them (ids for status, assignee, label, cycle, createdBy).`,
    '',
    'Actions (actions[].type):',
    ...lines((actionSchema as unknown as { options: unknown[] }).options, ACTION_DOC),
    '',
    'Safety: a rule that was triggered by a rule is chained at most 3 levels deep, then dropped. Executions are recorded in automations_runs (status ok|skipped|error).',
    '',
    'How to manage rules via MCP tools:',
    '- list_automations (projectId*) — read the rules of a project.',
    '- create_automation — create a rule (projectId*, name*, trigger*, actions*; conditions, description, enabled optional).',
    '- update_automation — change a rule by id (any of name, description, trigger, conditions, actions, enabled).',
    '- delete_automation — delete a rule by id.',
    'Create/update/delete are write tools and need the user\'s confirmation in chat. Rule runs history (automations_runs) and a manual "run now" are not available via MCP. Ids in trigger/conditions/actions (statuses, labels, users, fields) come from the project; read them first with the project tools (see the mcp section).',
  ].join('\n'),
};
