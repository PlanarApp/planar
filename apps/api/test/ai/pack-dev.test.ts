// PLNRAPP-418: pack «Разработка» — the start of the dev flow moves the task «К работе» → «В работе»,
// the answer to the AI's question brings it back to «В работе» and the dev run goes on.
import { describe, expect, it } from 'vitest';
import { readCatalogPack } from '@planar/module-ai/api';
import { parseHarnessYaml } from '@planar/module-ai/shared';

const pack = async () => parseHarnessYaml((await readCatalogPack('dev'))!['harness.yml']!);

describe('pack dev', () => {
  it('dev_in_todo: «К работе» → status «В работе» before the dev run', async () => {
    const h = await pack();
    const r = h.rules.find((x) => x.key === 'dev_in_todo')!;
    expect(r.trigger).toEqual({ type: 'task.status_changed', to: ['todo'] });
    expect(r.actions).toEqual([
      { type: 'set_status', statusId: 'in_progress' },
      { type: 'ai_run', action: 'dev' },
    ]);
    expect(h.statuses.find((s) => s.key === 'in_progress')?.name).toBe('В работе');
  });

  it('dev_resumed: back from the question status to «В работе» — the dev run again', async () => {
    const h = await pack();
    const r = h.rules.find((x) => x.key === 'dev_resumed')!;
    expect(r.trigger).toEqual({
      type: 'task.status_changed',
      from: [h.settings.questionStatus],
      to: ['in_progress'],
    });
    expect(r.filter).toEqual({ assignee: ['ai'] });
    expect(r.actions).toEqual([{ type: 'ai_run', action: 'dev' }]);
  });

  // PLNRAPP-682: the test run asked a question — the answer brings the task back to «Test prod», the test runs again
  it('test_resumed: back from the question status to «Test prod» — the test run again', async () => {
    const h = await pack();
    const r = h.rules.find((x) => x.key === 'test_resumed')!;
    expect(r.trigger).toEqual({
      type: 'task.status_changed',
      from: [h.settings.questionStatus],
      to: ['test_prod'],
    });
    expect(r.filter).toEqual({ assignee: ['ai'] });
    expect(r.actions).toEqual([{ type: 'ai_run', action: 'test' }]);
  });

  // PLNRAPP-655: a moveTo into a status no AI rule starts from leaves the task on the AI with nobody to move it on
  it('every moveTo of the instructions leads to a final status or to an AI rule', async () => {
    const files = (await readCatalogPack('dev'))!;
    const h = await pack();
    const targets = Object.entries(files)
      .filter(([k]) => k.startsWith('actions/'))
      .flatMap(([k, text]) => [...text.matchAll(/moveTo:\s*«([^»]+)»/g)].map((m) => [k, m[1]!]));
    expect(targets.length).toBeGreaterThan(0);
    const startsAi = (key: string) =>
      h.rules.some(
        (r) =>
          r.trigger.type === 'task.status_changed' &&
          !r.trigger.from &&
          (r.trigger.to as string[] | undefined)?.includes(key) &&
          r.actions.some((a) => a.type === 'ai_run'),
      );
    // PLNRAPP-776: a decomposed task waits for its subtasks — the rule on their closing moves it on;
    // PLNRAPP-807: «Планирование» decomposes a big task in the same run
    const decomposes = ['actions/decompose.md', 'actions/plan.md'];
    const subtasksMove = (key: string) =>
      h.rules.some(
        (r) =>
          r.trigger.type === 'task.subtasks_closed' &&
          (r.filter?.status as string[] | undefined)?.includes(key),
      );
    const dead = targets.filter(([k, name]) => {
      const s = h.statuses.find((x) => x.name === name);
      return (
        !s ||
        (s.category !== 'done' &&
          s.category !== 'cancelled' &&
          !startsAi(s.key) &&
          !(decomposes.includes(k) && subtasksMove(s.key)))
      );
    });
    expect(dead).toEqual([]);
  });
});
