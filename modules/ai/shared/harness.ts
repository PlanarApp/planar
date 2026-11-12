import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

/** Pure core of a harness pack (PLNRAPP-169): format, parsing, diff against the project state. No DB, no Vue. */

// same as AI_ACTION_KEY_RE / AI_RUNTIMES of index.ts (not imported: index re-exports this file)
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);
const STATUS_CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'user', 'url', 'money'] as const;

const statusSchema = z.object({
  key,
  name: z.string().min(1).max(100),
  category: z.enum(STATUS_CATEGORIES),
  color: z.string().min(1).max(50).optional(),
});
const labelSchema = z.object({
  key,
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(50).optional(),
});
const fieldSchema = z.object({
  key,
  name: z.string().min(1).max(100),
  type: z.enum(FIELD_TYPES),
});
const ruleSchema = z.object({
  /** identity of the rule in the pack; the name if omitted */
  key: key.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  /** to/from/statuses hold status keys; the rest is checked by the automations contract on apply */
  trigger: z.looseObject({ type: z.string().min(1) }),
  filter: z.record(z.string(), z.unknown()).optional(),
  actions: z
    .array(z.looseObject({ type: z.string().min(1) }))
    .min(1)
    .max(10),
  enabled: z.boolean().default(true),
});

export const ruleKey = (r: { key?: string; name: string }) => r.key ?? r.name;

/** AI events without a rule: an assigned comment, an @ai mention, a checklist item, a chat message. */
export const AI_EVENTS = ['comment', 'mention', 'checklist', 'chat'] as const;
export type AiEvent = (typeof AI_EVENTS)[number];
/** event → action key of the pack; no key — the built-in prompt */
export const eventsSchema = z.partialRecord(z.enum(AI_EVENTS), key);
export type AiEvents = z.infer<typeof eventsSchema>;

export const harnessSchema = z
  .object({
    statuses: z.array(statusSchema).default([]),
    labels: z.array(labelSchema).default([]),
    fields: z.array(fieldSchema).default([]),
    actions: z.array(key).default([]),
    rules: z.array(ruleSchema).default([]),
    settings: z.object({ questionStatus: key.optional() }).default({}),
    events: eventsSchema.default({}),
  })
  .superRefine((h, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const dup = (what: string, keys: string[]) => {
      const d = keys.find((k, i) => keys.indexOf(k) !== i);
      if (d) issue(`${what}: повтор ключа ${d}`);
    };
    dup(
      'statuses',
      h.statuses.map((s) => s.key),
    );
    dup(
      'labels',
      h.labels.map((s) => s.key),
    );
    dup(
      'fields',
      h.fields.map((s) => s.key),
    );
    dup('actions', h.actions);
    dup('rules', h.rules.map(ruleKey));
    const st = new Set(h.statuses.map((s) => s.key));
    const need = (k: string, where: string) => st.has(k) || issue(`${where}: нет статуса ${k}`);
    if (h.settings.questionStatus) need(h.settings.questionStatus, 'settings.questionStatus');
    for (const r of h.rules) {
      const t = r.trigger as Record<string, unknown>;
      for (const f of ['from', 'to', 'statuses'])
        if (Array.isArray(t[f])) for (const k of t[f]) need(String(k), `правило «${r.name}» ${f}`);
      for (const a of r.actions)
        if (a.type === 'ai_run' && !h.actions.includes(String(a.action)))
          issue(`правило «${r.name}»: нет действия ${String(a.action)}`);
    }
    for (const [e, a] of Object.entries(h.events))
      if (!h.actions.includes(a)) issue(`events.${e}: нет действия ${a}`);
  });
export type Harness = z.infer<typeof harnessSchema>;
type HarnessRule = Harness['rules'][number];

export const instructionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  runtime: z.enum(['llm', 'agent']).default('llm'),
  model: z.string().min(1).max(200).optional(),
  checks: z.array(z.string().min(1).max(500)).max(20).default([]),
});
export type Instruction = z.infer<typeof instructionSchema> & { prompt: string };

const fail = (what: string, e: z.ZodError) =>
  new Error(
    `${what}: ${e.issues.map((i) => `${i.path.join('.') || '/'} ${i.message}`).join('; ')}`,
  );

function yaml(text: string, what: string): unknown {
  try {
    return parseYaml(text);
  } catch (e) {
    throw new Error(`${what}: ${(e as Error).message}`);
  }
}

export function parseHarnessYaml(text: string): Harness {
  const r = harnessSchema.safeParse(yaml(text, 'harness.yml') ?? {});
  if (!r.success) throw fail('harness.yml', r.error);
  return r.data;
}

/** `---` frontmatter (name, description, runtime, model, checks) + the prompt body. */
export function parseInstructionDoc(text: string): Instruction {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(text.trim());
  if (!m) throw new Error('инструкция: нет frontmatter ---');
  const r = instructionSchema.safeParse(yaml(m[1]!, 'инструкция') ?? {});
  if (!r.success) throw fail('инструкция', r.error);
  return { ...r.data, prompt: (m[2] ?? '').trim() };
}

export const HARNESS_KINDS = ['status', 'label', 'field', 'action', 'rule'] as const;
export type HarnessKind = (typeof HARNESS_KINDS)[number];
/** ai_harness_keys: kind → key → entityId */
export type HarnessKeys = Partial<Record<HarnessKind, Record<string, string>>>;

export interface CurrentState {
  statuses: {
    id: string;
    name: string;
    category: string;
    color?: string | null;
    taskCount: number;
  }[];
  labels: { id: string; name: string; color?: string | null }[];
  fields: { id: string; name: string; type: string }[];
  actions: {
    id: string;
    name: string;
    description?: string | null;
    runtime: string;
    model?: string | null;
    checks: string[];
    questionStatusId?: string | null;
  }[];
  /** a keyed rule is always updated: the stored form (ids, bot) cannot be compared with the pack form */
  rules: { id: string; name: string; description?: string | null }[];
}

export interface HarnessOp {
  kind: HarnessKind;
  op: 'create' | 'update' | 'delete' | 'enable';
  key: string;
  /** the existing entity (update, delete) */
  id?: string;
  /** create: the whole entity; update: only changed fields */
  data?: Record<string, unknown>;
  /** delete of a status with tasks: key of the status they move to */
  replaceWith?: string;
}
export interface HarnessDiff {
  ops: HarnessOp[];
  errors: string[];
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

const withoutKey = (w: { key: string }): Record<string, unknown> =>
  Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'key'));

/** Changed fields among the ones the pack sets explicitly (unset color etc. means "default", not a change). */
function changes(cur: object, want: Record<string, unknown>): Record<string, unknown> | null {
  const c = cur as Record<string, unknown>;
  const out = Object.fromEntries(
    Object.entries(want).filter(
      ([k, v]) => v !== undefined && stable(v) !== stable(c[k] ?? undefined),
    ),
  );
  return Object.keys(out).length ? out : null;
}

/**
 * Diff of the pack against the project. Order of ops is fixed: statuses, labels, fields, actions, rules
 * (created with enabled=false), then `enable` of the rules; inside a kind: create, update, delete.
 * `keys` maps pack keys to existing entities (ai_harness_keys). `instructions` (action key → parsed
 * instruction) lets existing actions be compared and new ones named.
 */
export function computeDiff(
  current: CurrentState,
  pack: Harness,
  replaceWith: Record<string, string> = {},
  keys: HarnessKeys = {},
  instructions: Record<string, Instruction> = {},
): HarnessDiff {
  const ops: HarnessOp[] = [];
  const errors: string[] = [];
  const enable: HarnessOp[] = [];

  function sync<C extends { id: string }, W extends { key: string }>(
    kind: HarnessKind,
    cur: C[],
    want: W[],
    data: (w: W) => Record<string, unknown>,
    onDelete?: (c: C, k: string) => Partial<HarnessOp>,
  ) {
    const map = keys[kind] ?? {};
    const byId = new Map(cur.map((c) => [c.id, c]));
    const creates: HarnessOp[] = [];
    const updates: HarnessOp[] = [];
    for (const w of want) {
      const c = map[w.key] ? byId.get(map[w.key]!) : undefined;
      if (!c) creates.push({ kind, op: 'create', key: w.key, data: data(w) });
      else {
        const ch = changes(c, data(w));
        if (ch) updates.push({ kind, op: 'update', key: w.key, id: c.id, data: ch });
      }
    }
    const wanted = new Set(want.map((w) => w.key));
    const deletes: HarnessOp[] = [];
    for (const [k, id] of Object.entries(map)) {
      const c = byId.get(id);
      if (wanted.has(k) || !c) continue;
      deletes.push({ kind, op: 'delete', key: k, id, ...onDelete?.(c, k) });
    }
    ops.push(...creates, ...updates, ...deletes);
  }

  const statusKeys = new Set(pack.statuses.map((s) => s.key));
  sync('status', current.statuses, pack.statuses, withoutKey, (c, k) => {
    if (c.taskCount === 0) return {};
    const to = replaceWith[k];
    if (!to) errors.push(`статус ${k}: в нём ${c.taskCount} задач, нужен replaceWith`);
    else if (!statusKeys.has(to)) errors.push(`статус ${k}: replaceWith ${to} нет в пакете`);
    return to ? { replaceWith: to } : {};
  });
  for (const k of Object.keys(replaceWith)) {
    if (!current.statuses.some((s) => s.id === keys.status?.[k]))
      errors.push(`replaceWith ${k}: такого статуса нет в проекте`);
    else if (statusKeys.has(k)) errors.push(`replaceWith ${k}: статус остаётся в пакете`);
  }
  sync('label', current.labels, pack.labels, withoutKey);
  sync('field', current.fields, pack.fields, withoutKey);
  // `questionStatus` (key) is in the data so that a changed setting alone makes an update
  const statusKeyOf = new Map(Object.entries(keys.status ?? {}).map(([k, id]) => [id, k]));
  const questionStatus = pack.settings.questionStatus;
  sync(
    'action',
    current.actions.map((a) => ({
      ...a,
      questionStatus: a.questionStatusId ? statusKeyOf.get(a.questionStatusId) : undefined,
    })),
    pack.actions.map((k) => ({ key: k })),
    ({ key: k }) => {
      const i = instructions[k];
      return i
        ? {
            name: i.name,
            description: i.description,
            runtime: i.runtime,
            model: i.model,
            checks: i.checks,
            questionStatus,
          }
        : { name: k, questionStatus };
    },
  );

  const ruleMap = keys.rule ?? {};
  const rulesById = new Map(current.rules.map((r) => [r.id, r]));
  const rdata = (r: HarnessRule) => ({
    name: r.name,
    description: r.description,
    trigger: r.trigger,
    filter: r.filter,
    actions: r.actions,
  });
  const creates: HarnessOp[] = [];
  const updates: HarnessOp[] = [];
  for (const r of pack.rules) {
    const k = ruleKey(r);
    const c = ruleMap[k] ? rulesById.get(ruleMap[k]!) : undefined;
    if (!c) {
      creates.push({ kind: 'rule', op: 'create', key: k, data: { ...rdata(r), enabled: false } });
      if (r.enabled) enable.push({ kind: 'rule', op: 'enable', key: k });
    } else updates.push({ kind: 'rule', op: 'update', key: k, id: c.id, data: rdata(r) });
  }
  const wantedRules = new Set(pack.rules.map(ruleKey));
  const deletes = Object.entries(ruleMap)
    .filter(([k, id]) => !wantedRules.has(k) && rulesById.has(id))
    .map(([k, id]): HarnessOp => ({ kind: 'rule', op: 'delete', key: k, id }));
  ops.push(...creates, ...updates, ...deletes, ...enable);
  return { ops, errors };
}
