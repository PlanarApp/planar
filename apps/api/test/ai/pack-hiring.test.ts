// AIP-2: pack «Найм» — format, diff on an empty project, ban on protected attributes in every prompt.
import { describe, expect, it } from 'vitest';
import { readCatalogPack } from '@planar/module-ai/api';
import {
  computeDiff,
  parseHarnessYaml,
  parseInstructionDoc,
  type CurrentState,
} from '@planar/module-ai/shared';

const empty: CurrentState = { statuses: [], labels: [], fields: [], actions: [], rules: [] };
const ACTIONS = [
  'screening',
  'questionnaire',
  'interview_questions',
  'interview_summary',
  'offer',
  'rejection',
  'ping',
  'report',
  'assign',
  'mention',
  'checklist',
  'chat',
];

describe('pack hiring', () => {
  it('parses; statuses, fields, labels, rules as in the card', async () => {
    const files = (await readCatalogPack('hiring'))!;
    const h = parseHarnessYaml(files['harness.yml']!);
    expect(h.statuses.map((s) => s.key)).toEqual([
      'applied',
      'screening',
      'clarify',
      'interview',
      'test',
      'offer',
      'hired',
      'rejected',
    ]);
    expect(h.statuses.find((s) => s.key === 'clarify')!.category).toBe('todo');
    expect(h.statuses.find((s) => s.key === 'hired')!.category).toBe('done');
    expect(h.statuses.find((s) => s.key === 'rejected')!.category).toBe('cancelled');
    expect(h.settings.questionStatus).toBe('clarify');
    expect(h.labels.map((l) => l.key)).toEqual(['strong', 'no_reply', 'waiting']);
    expect(h.fields.map((f) => [f.key, f.type])).toEqual([
      ['email', 'text'],
      ['source', 'text'],
      ['resume', 'url'],
      ['expected_salary', 'money'],
    ]);
    expect(h.actions).toEqual(ACTIONS);
    expect(h.rules.every((r) => (r.filter as { assignee: string[] }).assignee[0] === 'ai')).toBe(
      true,
    );
    expect(h.rules.every((r) => r.enabled)).toBe(true);
    expect(h.rules.find((r) => r.trigger.type === 'task.stale')!.trigger).toMatchObject({
      days: 3,
    });
    expect(h.rules.find((r) => r.trigger.type === 'schedule')!.trigger).toMatchObject({
      cron: '0 17 * * 5',
    });
  });

  it('every action is llm, non-empty, and forbids protected attributes', async () => {
    const files = (await readCatalogPack('hiring'))!;
    const h = parseHarnessYaml(files['harness.yml']!);
    for (const k of h.actions) {
      expect(files[`actions/${k}.md`], k).toBeDefined();
      const i = parseInstructionDoc(files[`actions/${k}.md`]!);
      expect(i.runtime, k).toBe('llm');
      expect(i.prompt, k).not.toBe('');
      expect(i.prompt, k).toContain('Запрет');
      expect(i.prompt, k).toContain('защищённым');
      expect(i.prompt, k).toContain('признакам');
    }
    for (const k of ['screening', 'questionnaire', 'interview_summary']) {
      expect(parseInstructionDoc(files[`actions/${k}.md`]!).prompt, k).toContain(
        'передаются провайдеру LLM',
      );
    }
    expect(parseInstructionDoc(files['actions/report.md']!).prompt).toContain('Отчёты по найму');
  });

  it('computeDiff on an empty project: no errors, all rules created and enabled', async () => {
    const h = parseHarnessYaml((await readCatalogPack('hiring'))!['harness.yml']!);
    const { ops, errors } = computeDiff(empty, h);
    expect(errors).toEqual([]);
    expect(ops.filter((o) => o.kind === 'rule' && o.op === 'create')).toHaveLength(h.rules.length);
    expect(ops.filter((o) => o.kind === 'rule' && o.op === 'enable')).toHaveLength(h.rules.length);
    expect(ops.filter((o) => o.kind === 'action' && o.op === 'create')).toHaveLength(
      ACTIONS.length,
    );
  });
});
