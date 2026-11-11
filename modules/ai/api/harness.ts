import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { docToMarkdown } from '@planar/editor/markdown';
import { HttpError, type Db, type Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  AI_BOT_LOGIN,
  computeDiff,
  instructionSchema,
  parseHarnessYaml,
  type CurrentState,
  type Harness,
  type HarnessDiff,
  type HarnessKeys,
  type HarnessKind,
  type HarnessOp,
  type Instruction,
} from '../shared/index.js';

/** Server side of a harness pack (PLNRAPP-169): pack from the project docs, state of the project, ops → mutations. */

type Row = Record<string, unknown>;
type Node = { type?: string; text?: string; attrs?: Row; content?: Node[] };
type Mut = { name: string; args: Record<string, unknown> };
const rows = async (q: Db | Q, s: ReturnType<typeof sql>) => (await q.execute(s)).rows as Row[];
const text = (n: Node): string => n.text ?? (n.content ?? []).map(text).join(' ').trim();
const bad = (m: string) => new HttpError(400, 'invalid_request', m);

const INSTRUCTION_PARAMS = ['key', 'name', 'runtime', 'model', 'checks'];

/**
 * Instruction page: the first paragraph is the description, a table «parameter | value» (key, name, runtime,
 * model, checks — one per line) carries the parameters, everything after the table is the prompt. A page
 * without such a table is a bare prompt (`structured: false`): the whole page.
 */
export function parseInstructionPage(title: string, body: unknown) {
  const nodes = ((body as Node | null)?.content ?? []) as Node[];
  const t = nodes.findIndex((n) => n.type === 'table');
  const params: Row = {};
  for (const r of t < 0 ? [] : (nodes[t]!.content ?? [])) {
    const [k, ...v] = (r.content ?? []).map(text);
    const name = k?.trim().toLowerCase();
    if (name && INSTRUCTION_PARAMS.includes(name)) params[name] = v.join(' ').trim();
  }
  const head = t > 0 && nodes[0]!.type === 'paragraph' ? text(nodes[0]!) : undefined;
  const promptNodes = t < 0 ? nodes : nodes.slice(t + 1);
  const prompt = docToMarkdown({ type: 'doc', content: promptNodes } as never).trim();
  const checks = String(params.checks ?? '')
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);
  const r = instructionSchema.safeParse({
    name: params.name || title,
    description: head || undefined,
    runtime: params.runtime || undefined,
    model: params.model || undefined,
    checks,
  });
  if (!r.success)
    throw bad(`инструкция «${title}»: ${r.error.issues.map((i) => i.message).join('; ')}`);
  return {
    instruction: { ...r.data, prompt } satisfies Instruction,
    key: (params.key as string | undefined) || title,
    structured: t >= 0,
  };
}

const harnessBlock = (nodes: Node[]) =>
  nodes.find((n) => n.type === 'codeBlock' && /ya?ml|harness/i.test(String(n.attrs?.language)));

export interface LoadedPack {
  pack: Harness;
  /** action key → instruction and its page */
  instructions: Record<string, Instruction>;
  pageIds: Record<string, string>;
  errors: string[];
}

export async function loadPack(q: Db | Q, projectId: string, packPageId: string) {
  const [root] = await rows(
    q,
    sql`select body from docs_pages where id = ${packPageId}::uuid and project_id = ${projectId}::uuid
        and archived_at is null`,
  );
  if (!root) throw new HttpError(404, 'not_found', 'Страница пакета не найдена');
  const block = harnessBlock(((root.body as Node).content ?? []) as Node[]);
  if (!block) throw bad('в странице пакета нет блока harness.yml');
  let pack: Harness;
  try {
    pack = parseHarnessYaml(text(block));
  } catch (e) {
    throw bad((e as Error).message);
  }
  const kids = await rows(
    q,
    sql`select id, title, body from docs_pages where parent_id = ${packPageId}::uuid
        and archived_at is null order by rank collate "C"`,
  );
  const instructions: Record<string, Instruction> = {};
  const pageIds: Record<string, string> = {};
  for (const k of kids) {
    const p = parseInstructionPage(k.title as string, k.body);
    instructions[p.key] = p.instruction;
    pageIds[p.key] = k.id as string;
  }
  const errors = pack.actions
    .filter((a) => !pageIds[a])
    .map((a) => `действие ${a}: нет страницы инструкции`);
  return { pack, instructions, pageIds, errors } satisfies LoadedPack;
}

async function keysOf(q: Db | Q, projectId: string): Promise<HarnessKeys> {
  const out: HarnessKeys = {};
  for (const r of await rows(
    q,
    sql`select kind, key, entity_id as "id" from ai_harness_keys where project_id = ${projectId}::uuid`,
  ))
    (out[r.kind as HarnessKind] ??= {})[r.key as string] = r.id as string;
  return out;
}

async function currentOf(q: Db | Q, projectId: string): Promise<CurrentState> {
  const p = sql`${projectId}::uuid`;
  const [statuses, labels, fields, actions, rules] = await Promise.all([
    rows(
      q,
      sql`select s.id, s.name, s.category, s.color,
          (select count(*)::int from tasks t where t.status_id = s.id) as "taskCount"
          from statuses s where s.project_id = ${p}`,
    ),
    rows(q, sql`select id, name, color from labels where project_id = ${p}`),
    rows(q, sql`select id, name, type from field_defs where project_id = ${p}`),
    rows(
      q,
      sql`select id, name, description, runtime, model, checks from ai_actions where project_id = ${p}`,
    ),
    rows(q, sql`select id, name, description from automations_rules where project_id = ${p}`),
  ]);
  return { statuses, labels, fields, actions, rules } as unknown as CurrentState;
}

/** The diff of the pack against the project; `errors` also holds missing instruction pages. */
export async function diffOf(
  q: Db | Q,
  projectId: string,
  packPageId: string,
  replaceWith: Record<string, string> = {},
) {
  const loaded = await loadPack(q, projectId, packPageId);
  const d: HarnessDiff = computeDiff(
    await currentOf(q, projectId),
    loaded.pack,
    replaceWith,
    await keysOf(q, projectId),
    loaded.instructions,
  );
  return { ...loaded, ops: d.ops, errors: [...loaded.errors, ...d.errors] };
}

const COLORS: Record<string, string> = {
  backlog: '#94a3b8',
  todo: '#3b82f6',
  in_progress: '#f59e0b',
  done: '#22c55e',
  cancelled: '#ef4444',
};
const LABEL_COLOR = '#3b82f6';

/**
 * Mutations of the ops in dependency order: rules to delete first; then statuses, labels, fields, actions;
 * rules to create (enabled=false) and update; at the end `enable`. `keyWrites` — the pack keys to store.
 */
export async function buildMutations(
  q: Db | Q,
  projectId: string,
  loaded: LoadedPack,
  ops: HarnessOp[],
) {
  const { pack, pageIds } = loaded;
  const ids: Record<HarnessKind, Record<string, string>> = {
    status: {},
    label: {},
    field: {},
    action: {},
    rule: {},
  };
  for (const [kind, m] of Object.entries(await keysOf(q, projectId)))
    Object.assign(ids[kind as HarnessKind], m);
  for (const o of ops) if (o.op === 'create') ids[o.kind][o.key] = uuidv7();
  const bot = (await rows(q, sql`select id from users where login = ${AI_BOT_LOGIN} and bot`))[0]
    ?.id as string | undefined;

  const last = async (table: 'statuses' | 'field_defs') =>
    ((
      await rows(
        q,
        sql`select max(rank collate "C") as r from ${sql.identifier(table)} where project_id = ${projectId}::uuid`,
      )
    )[0]?.r ?? null) as string | null;
  const ranks = { status: await last('statuses'), field: await last('field_defs') };
  const rank = (k: 'status' | 'field') => (ranks[k] = generateKeyBetween(ranks[k], null));

  const lookup = (kind: HarnessKind, v: unknown) =>
    typeof v === 'string' ? (ids[kind][v] ?? v) : v;
  const list = (kind: HarnessKind, v: unknown) =>
    Array.isArray(v) ? v.map((x) => lookup(kind, x)) : v;
  const trigger = (t: Row) => ({
    ...t,
    ...Object.fromEntries(
      ['from', 'to', 'statuses'].filter((f) => f in t).map((f) => [f, list('status', t[f])]),
    ),
  });
  const FILTER_KIND: Record<string, HarnessKind | undefined> = { status: 'status', label: 'label' };
  const filter = (f: Row | undefined) => {
    if (!f) return undefined;
    if ('op' in f && 'rules' in f) return f;
    return {
      op: 'and',
      rules: Object.entries(f).map(([field, v]) => ({
        field,
        operator: 'in',
        value: (Array.isArray(v) ? v : [v]).map((x) =>
          field === 'assignee' && x === 'ai' && bot
            ? bot
            : FILTER_KIND[field]
              ? lookup(FILTER_KIND[field], x)
              : x,
        ),
      })),
    };
  };
  const action = (a: Row) => {
    if (a.type === 'ai_run') return { type: 'ai_run', aiActionId: lookup('action', a.action) };
    return {
      ...a,
      ...(a.statusId !== undefined && { statusId: lookup('status', a.statusId) }),
      ...(a.labelId !== undefined && { labelId: lookup('label', a.labelId) }),
    };
  };
  const questionStatusId = pack.settings.questionStatus
    ? ids.status[pack.settings.questionStatus]
    : undefined;
  const fallback = pack.statuses[0] && ids.status[pack.statuses[0].key];

  const mut = (o: HarnessOp): Mut | null => {
    const d = (o.data ?? {}) as Row;
    const id = o.id ?? ids[o.kind][o.key]!;
    const base = { id, projectId };
    const enc = `${o.kind}.${o.op}`;
    switch (enc) {
      case 'status.create':
        return {
          name: 'status.create',
          args: {
            ...base,
            ...d,
            color: d.color ?? COLORS[d.category as string],
            rank: rank('status'),
          },
        };
      case 'label.create':
        return { name: 'label.create', args: { ...base, ...d, color: d.color ?? LABEL_COLOR } };
      case 'field.create':
        return { name: 'field.create', args: { ...base, ...d, rank: rank('field') } };
      case 'action.create':
        return {
          name: 'ai.action.create',
          args: { ...base, ...d, key: o.key, pageId: pageIds[o.key], questionStatusId },
        };
      case 'rule.create':
        return {
          name: 'automations.create',
          args: {
            ...base,
            name: d.name,
            description: d.description,
            trigger: trigger(d.trigger as Row),
            conditions: filter(d.filter as Row | undefined),
            actions: (d.actions as Row[]).map(action),
            enabled: false,
          },
        };
      case 'status.update':
      case 'label.update':
        return { name: enc, args: { id, ...d } };
      // the type of a field cannot change
      case 'field.update':
        return d.name ? { name: enc, args: { id, name: d.name } } : null;
      case 'action.update':
        return {
          name: 'ai.action.update',
          args: { id, ...d, pageId: pageIds[o.key], questionStatusId },
        };
      case 'rule.update':
        return {
          name: 'automations.update',
          args: {
            id,
            name: d.name,
            description: d.description,
            trigger: trigger(d.trigger as Row),
            conditions: filter(d.filter as Row | undefined),
            actions: (d.actions as Row[]).map(action),
          },
        };
      case 'status.delete':
        return {
          name: enc,
          args: { id, replaceWith: o.replaceWith ? ids.status[o.replaceWith] : fallback },
        };
      case 'rule.delete':
        return { name: 'automations.delete', args: { id } };
      case 'action.delete':
        return { name: 'ai.action.delete', args: { id } };
      case 'rule.enable':
        return { name: 'automations.update', args: { id, enabled: true } };
      default:
        return { name: enc, args: { id } };
    }
  };

  const rank0 = (o: HarnessOp) =>
    o.kind === 'rule'
      ? o.op === 'delete'
        ? 0
        : o.op === 'enable'
          ? 6
          : 5
      : 1 + HARNESS_ORDER(o.kind);
  const muts = [...ops]
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank0(a.o) - rank0(b.o) || a.i - b.i)
    .map(({ o }) => mut(o))
    .filter((m): m is Mut => !!m);
  const keyWrites = ops
    .filter((o) => o.op === 'create' || o.op === 'delete')
    .map((o) => ({ op: o.op, kind: o.kind, key: o.key, id: ids[o.kind][o.key]! }));
  return { muts, keyWrites };
}

const HARNESS_ORDER = (k: HarnessKind) => ['status', 'label', 'field', 'action'].indexOf(k);

/** ai_harness_keys in the transaction of the mutations. */
export async function writeKeys(
  q: Q,
  projectId: string,
  keyWrites: { op: string; kind: string; key: string; id: string }[],
) {
  for (const w of keyWrites)
    await q.execute(
      w.op === 'delete'
        ? sql`delete from ai_harness_keys where project_id = ${projectId}::uuid and kind = ${w.kind} and key = ${w.key}`
        : sql`insert into ai_harness_keys (id, project_id, kind, key, entity_id)
              values (${uuidv7()}::uuid, ${projectId}::uuid, ${w.kind}, ${w.key}, ${w.id}::uuid)
              on conflict (project_id, kind, key) do update set entity_id = excluded.entity_id`,
    );
}
