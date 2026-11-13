// AIP-1: the «Продажи» catalog pack parses and applies to an empty project.
import { describe, expect, it } from 'vitest';
import { readCatalogPack } from '@planar/module-ai/api';
import {
  computeDiff,
  parseHarnessYaml,
  parseInstructionDoc,
  type CurrentState,
} from '@planar/module-ai/shared';

const empty: CurrentState = { statuses: [], labels: [], fields: [], actions: [], rules: [] };

describe('pack sales', async () => {
  const files = (await readCatalogPack('sales'))!;
  const pack = parseHarnessYaml(files['harness.yml']!);

  it('has the statuses, labels, fields and actions of the card', () => {
    expect(pack.statuses.map((s) => s.key)).toEqual([
      'lead',
      'qualification',
      'clarify',
      'proposal',
      'negotiation',
      'snoozed',
      'won',
      'lost',
    ]);
    expect(pack.statuses.find((s) => s.key === 'clarify')!.category).toBe('todo');
    expect(pack.settings.questionStatus).toBe('clarify');
    expect(pack.labels.map((l) => l.name)).toEqual(['горячий', 'нет ответа', 'Ждёт ответа']);
    expect(pack.fields.map((f) => `${f.key}:${f.type}`)).toEqual([
      'company:text',
      'contact:text',
      'email:text',
      'amount:money',
      'source:text',
      'next_step:text',
    ]);
    expect(pack.actions).toEqual([
      'qualify',
      'proposal',
      'next_step',
      'lost',
      'followup',
      'digest',
      'research',
      'assign',
      'mention',
      'checklist',
      'chat',
    ]);
  });

  it('every action is an llm instruction with a prompt; research is an agent', () => {
    for (const k of pack.actions) {
      const text = files[`actions/${k}.md`];
      expect(text, k).toBeTruthy();
      const i = parseInstructionDoc(text!);
      expect(i.runtime, k).toBe(k === 'research' ? 'agent' : 'llm');
      expect(i.prompt.length, k).toBeGreaterThan(50);
    }
  });

  it('all rules are for the AI assignee and enabled', () => {
    expect(pack.rules).toHaveLength(11);
    for (const r of pack.rules) {
      expect((r.filter as { assignee: string[] }).assignee[0], r.name).toBe('ai');
      expect(r.enabled, r.name).toBe(true);
    }
    const wake = pack.rules.find((r) => r.key === 'wake_snoozed')!;
    expect(wake.trigger.type).toBe('task.start_reached');
    expect(wake.filter).toMatchObject({ status: ['snoozed'] });
  });

  it('computeDiff on an empty project: no errors, rules created and enabled', () => {
    const instr = Object.fromEntries(
      pack.actions.map((k) => [k, parseInstructionDoc(files[`actions/${k}.md`]!)]),
    );
    const { ops, errors } = computeDiff(empty, pack, {}, {}, instr);
    expect(errors).toEqual([]);
    const n = (kind: string, op: string) =>
      ops.filter((o) => o.kind === kind && o.op === op).length;
    expect(n('status', 'create')).toBe(8);
    expect(n('label', 'create')).toBe(3);
    expect(n('field', 'create')).toBe(6);
    expect(n('action', 'create')).toBe(11);
    expect(n('rule', 'create')).toBe(11);
    expect(n('rule', 'enable')).toBe(11);
  });
});
