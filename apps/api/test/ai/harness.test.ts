import { describe, expect, it } from 'vitest';
import {
  computeDiff,
  parseHarnessYaml,
  parseInstructionDoc,
  type CurrentState,
  type HarnessKeys,
} from '@planar/module-ai/shared';

const YML = `
statuses:
  - {key: backlog, name: Бэклог, category: backlog, color: gray}
  - {key: clarify, name: Уточнение, category: todo}
labels: [{key: has_plan, name: Есть план}]
fields: [{key: amount, name: Сумма, type: number}]
actions: [plan]
rules:
  - name: План в бэклоге
    trigger: {type: task.status_changed, to: [backlog]}
    actions: [{type: ai_run, action: plan}]
settings: {questionStatus: clarify}
`;

const empty: CurrentState = { statuses: [], labels: [], fields: [], actions: [], rules: [] };

describe('harness zod', () => {
  it('parses harness.yml with defaults', () => {
    const h = parseHarnessYaml(YML);
    expect(h.statuses).toHaveLength(2);
    expect(h.rules[0]!.enabled).toBe(true);
    expect(parseHarnessYaml('').rules).toEqual([]);
  });
  it('rejects broken refs, duplicates, bad yaml', () => {
    expect(() =>
      parseHarnessYaml(YML.replace('questionStatus: clarify', 'questionStatus: nope')),
    ).toThrow(/нет статуса nope/);
    expect(() => parseHarnessYaml(YML.replace('action: plan', 'action: dev'))).toThrow(
      /нет действия dev/,
    );
    expect(() => parseHarnessYaml(YML.replace('key: clarify', 'key: backlog'))).toThrow(/повтор/);
    expect(() => parseHarnessYaml(YML.replace('category: todo', 'category: x'))).toThrow(
      /category/,
    );
    expect(() => parseHarnessYaml('a: [')).toThrow(/harness\.yml/);
  });
  it('parses an instruction doc', () => {
    const i = parseInstructionDoc('---\nname: План\nchecks: [есть оценка]\n---\n\nСоставь план.\n');
    expect(i).toMatchObject({
      name: 'План',
      runtime: 'llm',
      checks: ['есть оценка'],
      prompt: 'Составь план.',
    });
    expect(() => parseInstructionDoc('без frontmatter')).toThrow(/frontmatter/);
    expect(() => parseInstructionDoc('---\nname: x\nruntime: gpu\n---\n')).toThrow(/runtime/);
  });
});

describe('harness diff', () => {
  it('creates everything in a fixed order, rules disabled then enabled last', () => {
    const { ops, errors } = computeDiff(empty, parseHarnessYaml(YML));
    expect(errors).toEqual([]);
    expect(ops.map((o) => `${o.kind}:${o.op}`)).toEqual([
      'status:create',
      'status:create',
      'label:create',
      'field:create',
      'action:create',
      'rule:create',
      'rule:enable',
    ]);
    expect(ops.find((o) => o.kind === 'rule' && o.op === 'create')!.data).toMatchObject({
      enabled: false,
    });
  });

  const cur: CurrentState = {
    ...empty,
    statuses: [
      { id: 's1', name: 'Бэклог', category: 'backlog', color: 'gray', taskCount: 0 },
      { id: 's2', name: 'Старый', category: 'todo', taskCount: 3 },
    ],
  };
  const keys: HarnessKeys = { status: { backlog: 's1', old: 's2' } };

  it('updates only changed fields, deletes keyed entities missing from the pack', () => {
    const { ops, errors } = computeDiff(
      { ...cur, statuses: [{ ...cur.statuses[0]!, name: 'Backlog' }, cur.statuses[1]!] },
      parseHarnessYaml(YML),
      { old: 'backlog' },
      keys,
    );
    expect(errors).toEqual([]);
    expect(ops.slice(0, 3)).toMatchObject([
      { kind: 'status', op: 'create', key: 'clarify' },
      { kind: 'status', op: 'update', key: 'backlog', id: 's1', data: { name: 'Бэклог' } },
      { kind: 'status', op: 'delete', key: 'old', id: 's2', replaceWith: 'backlog' },
    ]);
  });

  it('requires a valid replaceWith for a status with tasks', () => {
    const pack = parseHarnessYaml(YML);
    expect(computeDiff(cur, pack, {}, keys).errors).toEqual([
      expect.stringContaining('нужен replaceWith'),
    ]);
    expect(computeDiff(cur, pack, { old: 'zzz' }, keys).errors).toEqual([
      expect.stringContaining('нет в пакете'),
    ]);
    expect(computeDiff(cur, pack, { backlog: 'clarify' }, keys).errors).toEqual([
      expect.stringContaining('нужен replaceWith'),
      expect.stringContaining('остаётся в пакете'),
    ]);
  });

  it('an empty status is deleted without replaceWith; unchanged pack gives no ops', () => {
    const state: CurrentState = {
      statuses: [
        { id: 's1', name: 'Бэклог', category: 'backlog', color: 'gray', taskCount: 5 },
        { id: 's2', name: 'Уточнение', category: 'todo', taskCount: 0 },
        { id: 's3', name: 'Лишний', category: 'todo', taskCount: 0 },
      ],
      labels: [{ id: 'l1', name: 'Есть план' }],
      fields: [{ id: 'f1', name: 'Сумма', type: 'number' }],
      actions: [{ id: 'a1', name: 'plan', runtime: 'llm', checks: [] }],
      rules: [],
    };
    const k: HarnessKeys = {
      status: { backlog: 's1', clarify: 's2', extra: 's3' },
      label: { has_plan: 'l1' },
      field: { amount: 'f1' },
      action: { plan: 'a1' },
    };
    const { ops, errors } = computeDiff(state, parseHarnessYaml(YML), {}, k);
    expect(errors).toEqual([]);
    expect(ops.map((o) => `${o.kind}:${o.op}:${o.key}`)).toEqual([
      'status:delete:extra',
      'rule:create:План в бэклоге',
      'rule:enable:План в бэклоге',
    ]);
  });
});
