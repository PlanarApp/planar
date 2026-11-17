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
});
