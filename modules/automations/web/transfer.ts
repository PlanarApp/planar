import type { Filter } from '@planar/shared';
import {
  EMPTY_FIELD_REF,
  actionSchema,
  filterSchema,
  triggerSchema,
  type Action,
  type Rule,
  type Trigger,
} from '../shared/index.js';

/** Portable export of automations: ids are replaced with natural keys, the target project binds them back. */
export const FORMAT = 'planar.automations';
export const VERSION = 1;

type Kind = 'status' | 'label' | 'field' | 'user' | 'aiAction' | 'project' | 'subscription';
/** A natural key in place of an id; without keys — the source entity was not found. */
export interface Ref {
  $ref: Kind;
  name?: string;
  category?: string;
  type?: string;
  login?: string;
  email?: string | null;
  url?: string;
}

/** Entities of one project (source on export, target on import). */
export interface Dict {
  statuses: { id: string; name: string; category: string }[];
  labels: { id: string; name: string }[];
  fields: { id: string; name: string; type: string }[];
  users: { id: string; login: string; email: string | null }[];
  aiActions: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  subscriptions: { id: string; url: string }[];
}

export interface PortableRule {
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: unknown;
  conditions: unknown;
  actions: unknown[];
}
export interface ExportFile {
  format: typeof FORMAT;
  version: number;
  rules: PortableRule[];
}

const DICT_KEY: Record<Kind, keyof Dict> = {
  status: 'statuses',
  label: 'labels',
  field: 'fields',
  user: 'users',
  aiAction: 'aiActions',
  project: 'projects',
  subscription: 'subscriptions',
};
type Entry = { id: string } & Record<string, unknown>;
const list = (d: Dict, k: Kind) => d[DICT_KEY[k]] as unknown as Entry[];

const toRef = (kind: Kind, id: string, d: Dict): Ref => {
  const e = list(d, kind).find((x) => x.id === id);
  if (!e) return { $ref: kind };
  switch (kind) {
    case 'status':
      return { $ref: kind, name: e.name as string, category: e.category as string };
    case 'field':
      return { $ref: kind, name: e.name as string, type: e.type as string };
    case 'user':
      return { $ref: kind, login: e.login as string, email: e.email as string | null };
    case 'subscription':
      return { $ref: kind, url: e.url as string };
    default:
      return { $ref: kind, name: e.name as string };
  }
};

/** Id of the target entity by a key; undefined — not found. Status: name + category, then the name alone. */
const fromRef = (ref: Ref, d: Dict): string | undefined => {
  const by = (f: (e: Entry) => boolean) => list(d, ref.$ref).find(f)?.id;
  switch (ref.$ref) {
    case 'status':
      return (
        by((e) => e.name === ref.name && e.category === ref.category) ??
        by((e) => e.name === ref.name)
      );
    case 'field':
      return by((e) => e.name === ref.name && e.type === ref.type);
    case 'user':
      return (
        (ref.login ? by((e) => e.login === ref.login) : undefined) ??
        (ref.email ? by((e) => e.email === ref.email) : undefined)
      );
    case 'subscription':
      return ref.url ? by((e) => e.url === ref.url) : undefined;
    default:
      return ref.name ? by((e) => e.name === ref.name) : undefined;
  }
};

// which condition field holds which kind of ids
const COND_KIND: Record<string, Kind> = {
  status: 'status',
  assignee: 'user',
  createdBy: 'user',
  label: 'label',
};
const isRef = (v: unknown): v is Ref =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Ref).$ref === 'string' &&
  (v as Ref).$ref in DICT_KEY;

// ---- export ----

const fieldKey = (f: unknown, d: Dict): unknown =>
  typeof f === 'string' && f.startsWith('field:') ? toRef('field', f.slice(6), d) : f;

export function exportRule(r: Rule, d: Dict): PortableRule {
  const ids = (k: Kind, v: unknown) =>
    Array.isArray(v) ? v.map((x) => toRef(k, String(x), d)) : v;
  const tr: Record<string, unknown> = { ...r.trigger };
  for (const k of ['from', 'to', 'statuses']) if (k in tr) tr[k] = ids('status', tr[k]);
  if (tr.type === 'task.assignee_changed') {
    // rules saved before PLNRAPP-197 hold a single userId: it joins userIds
    const users = [
      ...((tr.userIds as string[] | undefined) ?? []),
      ...(tr.userId ? [tr.userId as string] : []),
    ];
    delete tr.userId;
    if (users.length) tr.userIds = ids('user', [...new Set(users)]);
  }
  if (tr.type === 'task.field_changed') tr.field = fieldKey(tr.field, d);
  const conv = (f: Filter): unknown => ({
    ...f,
    rules: f.rules.map((x) => ({
      ...x,
      field: fieldKey(x.field, d),
      value:
        COND_KIND[x.field] && Array.isArray(x.value) ? ids(COND_KIND[x.field]!, x.value) : x.value,
    })),
    ...(f.groups ? { groups: f.groups.map(conv) } : {}),
  });
  const actions = r.actions.map((a) => {
    const o: Record<string, unknown> = { ...a };
    if ('statusId' in o) o.statusId = toRef('status', String(o.statusId), d);
    if ('userId' in o) o.userId = toRef('user', String(o.userId), d);
    if ('labelId' in o) o.labelId = toRef('label', String(o.labelId), d);
    if ('subscriptionId' in o)
      o.subscriptionId = toRef('subscription', String(o.subscriptionId), d);
    if ('aiActionId' in o) o.aiActionId = toRef('aiAction', String(o.aiActionId), d);
    if ('projectId' in o) o.projectId = toRef('project', String(o.projectId), d);
    if (o.type === 'set_field') o.field = fieldKey(o.field, d);
    return o;
  });
  return {
    name: r.name,
    description: r.description ?? null,
    enabled: r.enabled,
    trigger: tr,
    conditions: conv(r.conditions as Filter),
    actions,
  };
}

export const exportRules = (rules: Rule[], d: Dict): ExportFile => ({
  format: FORMAT,
  version: VERSION,
  rules: rules.map((r) => exportRule(r, d)),
});

// ---- import ----

export interface ImportedRule {
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: Trigger;
  conditions: Filter;
  actions: Action[];
  /** Keys not found in the target project (human-readable); non-empty — the rule is disabled. */
  missing: string[];
}

/** code — the key of the UI text (`tx.importErrors`), detail — a value for it. */
export class ImportError extends Error {
  constructor(
    readonly code: 'json' | 'format' | 'version' | 'empty' | 'broken',
    readonly detail = '',
  ) {
    super(code);
  }
}

const describe = (r: Ref): string => `${r.$ref} «${r.name ?? r.login ?? r.email ?? r.url ?? '?'}»`;

export function importRule(p: PortableRule, d: Dict): ImportedRule {
  const missing: string[] = [];
  const one = (v: unknown): string | undefined => {
    if (!isRef(v)) return typeof v === 'string' ? v : undefined;
    const id = fromRef(v, d);
    if (id === undefined) missing.push(describe(v));
    return id;
  };
  // lists lose the unfound ids (a trigger without ids fires on any value — the rule is disabled anyway)
  const many = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map(one).filter((x): x is string => !!x) : undefined;
  const field = (v: unknown): string => {
    if (!isRef(v)) return String(v);
    const id = one(v);
    return id ? `field:${id}` : EMPTY_FIELD_REF;
  };

  const tr: Record<string, unknown> = { ...(p.trigger as object) };
  for (const k of ['from', 'to', 'statuses', 'userIds']) if (k in tr) tr[k] = many(tr[k]);
  if (tr.type === 'task.field_changed') tr.field = field(tr.field);

  const conv = (f: Filter): Filter => ({
    ...f,
    rules: f.rules.flatMap((x) => {
      const fld = field(x.field);
      // a condition on a custom field that is gone is dropped (the rule is disabled and flagged)
      if (fld === EMPTY_FIELD_REF) return [];
      return [
        { ...x, field: fld, value: Array.isArray(x.value) ? many(x.value) : x.value },
      ] as Filter['rules'];
    }),
    ...(f.groups ? { groups: f.groups.map(conv) } : {}),
  });

  const actions = (p.actions ?? []).map((a) => {
    const o = { ...(a as Record<string, unknown>) };
    for (const k of ['statusId', 'userId', 'labelId', 'subscriptionId', 'aiActionId', 'projectId'])
      if (k in o) {
        const id = one(o[k]);
        if (id === undefined && k === 'statusId' && o.type === 'move_to_project') delete o.statusId;
        else o[k] = id ?? '';
      }
    if (o.type === 'set_field') o.field = field(o.field);
    return o;
  });

  const trigger = triggerSchema.safeParse(tr);
  const cond = filterSchema.safeParse(conv((p.conditions ?? { op: 'and', rules: [] }) as Filter));
  const acts = actions.map((a) => actionSchema.safeParse(a));
  if (!trigger.success || !cond.success || !acts.length || acts.some((a) => !a.success))
    throw new ImportError('broken', String(p.name));
  const uniq = [...new Set(missing)];
  return {
    name: String(p.name).slice(0, 100),
    description: p.description ?? null,
    enabled: uniq.length ? false : p.enabled !== false,
    trigger: trigger.data,
    conditions: cond.data as Filter,
    actions: acts.map((a) => (a as { data: Action }).data),
    missing: uniq,
  };
}

/** Parses the file text; broken JSON, a foreign format or an unknown version — ImportError. */
export function parseExport(src: string): ExportFile {
  let j: ExportFile;
  try {
    j = JSON.parse(src) as ExportFile;
  } catch {
    throw new ImportError('json');
  }
  if (j?.format !== FORMAT) throw new ImportError('format');
  if (j.version !== VERSION) throw new ImportError('version', String(j.version));
  if (!Array.isArray(j.rules)) throw new ImportError('empty');
  return j;
}

export const importRules = (f: ExportFile, d: Dict): ImportedRule[] =>
  f.rules.map((r) => importRule(r, d));
