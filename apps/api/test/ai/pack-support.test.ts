// AIP-3: package «Поддержка» — parses, diff on an empty project, rules and actions are consistent.
import { describe, expect, it } from 'vitest';
import { readCatalogPack } from '@planar/module-ai/api';
import {
  computeDiff,
  parseHarnessYaml,
  parseInstructionDoc,
  type CurrentState,
} from '@planar/module-ai/shared';

const empty: CurrentState = { statuses: [], labels: [], fields: [], actions: [], rules: [] };

describe('pack support', () => {
  it('parses; actions are llm with prompts; rules are for ai assignee', async () => {
    const files = (await readCatalogPack('support'))!;
    expect(files).toBeTruthy();
    const h = parseHarnessYaml(files['harness.yml']!);
    expect(h.statuses.map((s) => s.key)).toEqual([
      'new',
      'analysis',
      'clarify',
      'in_progress',
      'solved',
      'closed',
    ]);
    expect(h.settings.questionStatus).toBe('clarify');
    expect(h.labels.map((l) => l.name)).toEqual(['срочно', 'эскалировано', 'автозакрыто']);
    expect(h.fields.map((f) => f.key)).toEqual(['customer', 'email', 'category', 'urgency']);
    expect(h.actions).toEqual([
      'triage',
      'draft_reply',
      'escalate_dev',
      'close',
      'to_wiki',
      'assign',
      'mention',
      'checklist',
      'chat',
    ]);
    for (const a of h.actions) {
      const doc = files[`actions/${a}.md`];
      expect(doc, a).toBeTruthy();
      const i = parseInstructionDoc(doc!);
      expect(i.runtime).toBe('llm');
      expect(i.prompt.length).toBeGreaterThan(100);
    }
    for (const r of h.rules) expect((r.filter as { assignee: string[] }).assignee[0]).toBe('ai');
    const trig = (k: string) => h.rules.find((r) => r.key === k)!.trigger;
    expect(trig('escalate_unassigned')).toMatchObject({ type: 'task.unassigned', hours: 2 });
    expect(trig('auto_close_waiting')).toMatchObject({ type: 'task.waiting_human', days: 3 });
  });

  it('computeDiff on an empty project: no errors, all rules created and enabled', async () => {
    const h = parseHarnessYaml((await readCatalogPack('support'))!['harness.yml']!);
    const { ops, errors } = computeDiff(empty, h);
    expect(errors).toEqual([]);
    const n = (kind: string, op: string) =>
      ops.filter((o) => o.kind === kind && o.op === op).length;
    expect(n('status', 'create')).toBe(6);
    expect(n('label', 'create')).toBe(3);
    expect(n('field', 'create')).toBe(4);
    expect(n('action', 'create')).toBe(9);
    expect(n('rule', 'create')).toBe(4);
    expect(n('rule', 'enable')).toBe(4);
  });
});
