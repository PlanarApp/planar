// AIP-5: common test of the wave-1 catalog packs (sales, hiring, support): parse, diff, apply to a clean project, risks.
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { readCatalogPack } from '@planar/module-ai/api';
import {
  computeDiff,
  parseHarnessYaml,
  parseInstructionDoc,
  type CurrentState,
} from '@planar/module-ai/shared';
import { loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { key, world, type World } from '../sync/helpers.js';

useApp();

const KEYS = ['sales', 'hiring', 'support'] as const;
const empty: CurrentState = { statuses: [], labels: [], fields: [], actions: [], rules: [] };
const loaded = await Promise.all(
  KEYS.map(async (k) => {
    const files = (await readCatalogPack(k))!;
    return { k, files, pack: parseHarnessYaml(files['harness.yml']!) };
  }),
);

let w: World;
let cookie: string;
const raw = async (text: string, values: unknown[] = []) =>
  (await db.$client.query(text, values)).rows as Record<string, ReturnType<typeof JSON.parse>>[];
const post = (url: string, body: object) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: `/api/ai/${url}`,
      payload: body,
      headers: { cookie, origin: ORIGIN },
    });

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = randomBytes(32).toString('base64');
  w = await world(db);
  cookie = await loginCookie(db, w.admin.userId);
});

describe.each(loaded)('catalog pack $k', ({ k, files, pack }) => {
  const instr = () =>
    Object.fromEntries(
      pack.actions.map((a) => [a, parseInstructionDoc(files[`actions/${a}.md`]!)]),
    );

  it('parse: every action is an llm instruction, every rule is for the AI and enabled', () => {
    expect(pack.actions.length).toBeGreaterThan(0);
    for (const a of pack.actions) {
      const i = instr()[a]!;
      expect(i.runtime, a).toBe('llm');
      expect(i.prompt, a).not.toBe('');
    }
    for (const r of pack.rules) {
      expect((r.filter as { assignee: string[] }).assignee[0], r.name).toBe('ai');
      expect(r.enabled, r.name).toBe(true);
    }
  });

  it('computeDiff on an empty project: no errors, all rules enabled at the end', () => {
    const { ops, errors } = computeDiff(empty, pack, {}, {}, instr());
    expect(errors).toEqual([]);
    const n = (kind: string, op: string) =>
      ops.filter((o) => o.kind === kind && o.op === op).length;
    expect(n('status', 'create')).toBe(pack.statuses.length);
    expect(n('label', 'create')).toBe(pack.labels.length);
    expect(n('field', 'create')).toBe(pack.fields.length);
    expect(n('action', 'create')).toBe(pack.actions.length);
    expect(n('rule', 'create')).toBe(pack.rules.length);
    expect(n('rule', 'enable')).toBe(pack.rules.length);
  });

  it('apply via API on a clean project creates everything, rules are enabled', async () => {
    const P = uuidv7();
    await w.admin.ok('project.create', {
      id: P,
      spaceId: w.spaceId,
      name: k,
      key: key(),
      rank: 'a0',
    });
    const up = await post('packs/upload', { projectId: P, packKey: k });
    expect(up.statusCode).toBe(200);
    const packPageId = up.json().rootPageId as string;
    const d = (await post('harness/diff', { projectId: P, packPageId })).json();
    expect(d.errors).toEqual([]);
    expect((await post('harness/apply', { projectId: P, packPageId })).statusCode).toBe(200);

    const names = async (table: string) =>
      (await raw(`select name from ${table} where project_id = $1`, [P])).map(
        (r) => r.name as string,
      );
    const has = (got: string[], want: string[]) =>
      expect(got).toEqual(expect.arrayContaining(want));
    has(
      await names('statuses'),
      pack.statuses.map((s) => s.name),
    );
    has(
      await names('labels'),
      pack.labels.map((l) => l.name),
    );
    has(
      await names('field_defs'),
      pack.fields.map((f) => f.name),
    );
    const acts = await raw(`select key from ai_actions where project_id = $1`, [P]);
    expect(acts.map((a) => a.key).sort()).toEqual([...pack.actions].sort());
    const rules = await raw(`select enabled from automations_rules where project_id = $1`, [P]);
    expect(rules).toHaveLength(pack.rules.length);
    expect(rules.every((r) => r.enabled)).toBe(true);
  });

  it('risk stale: stale rules cannot reach terminal statuses', () => {
    // the scanner skips done/cancelled by category (automations.test.ts «task.stale» checks it); the pack must keep the terminal statuses there
    for (const r of pack.rules.filter((r) => r.trigger.type === 'task.stale')) {
      const only = (r.trigger as { statuses?: string[] }).statuses ?? [];
      for (const s of pack.statuses.filter((s) => only.includes(s.key)))
        expect(['done', 'cancelled'], r.key).not.toContain(s.category);
    }
    const terminal = pack.statuses.filter((s) => ['done', 'cancelled'].includes(s.category));
    expect(terminal.length).toBeGreaterThan(0);
  });

  it('risk chain: moveTo of status-triggered actions never loops back (acyclic)', () => {
    // edge: status a → rule → action → moveTo b. The engine fires only on a real change (before ≠ after), so repeats of the same status do not fire
    const nameToKey = Object.fromEntries(pack.statuses.map((s) => [s.name, s.key]));
    const edges = new Map<string, Set<string>>();
    for (const r of pack.rules) {
      const t = r.trigger as { type: string; to?: string[] };
      if (t.type !== 'task.status_changed') continue;
      for (const act of r.actions as { action: string }[]) {
        const md = files[`actions/${act.action}.md`]!;
        const to = [...md.matchAll(/moveTo\s+["«]([^"»]+)["»]/g)].map((m) => nameToKey[m[1]!]);
        for (const from of t.to ?? []) {
          for (const x of to) {
            if (x) edges.set(from, (edges.get(from) ?? new Set()).add(x));
          }
        }
      }
    }
    const visit = (n: string, path: string[]) => {
      expect(path, `цикл ${[...path, n].join('→')}`).not.toContain(n);
      for (const m of edges.get(n) ?? []) visit(m, [...path, n]);
    };
    for (const n of edges.keys()) visit(n, []);
  });
});

describe('hiring chain screening → questionnaire', () => {
  it('applied→screening→clarify: each step fires once, «Уточнение» has no AI rule', () => {
    const { pack, files } = loaded.find((l) => l.k === 'hiring')!;
    const on = (s: string) =>
      pack.rules.filter((r) => (r.trigger as { to?: string[] }).to?.includes(s));
    expect(on('applied').map((r) => r.key)).toEqual(['screen_applied']);
    expect(on('screening').map((r) => r.key)).toEqual(['questionnaire_screening']);
    expect(on('clarify')).toEqual([]);
    expect(files['actions/screening.md']).toContain('moveTo "Скрининг"');
    expect(files['actions/questionnaire.md']).toContain('moveTo "Уточнение"');
  });
});
