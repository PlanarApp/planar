import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push }),
}));

vi.mock('../../../../../../modules/import/web/data', async () => {
  const { ref } = await import('vue');
  const job = {
    id: 'j1',
    status: 'done',
    total: 3,
    processed: 3,
    created: 2,
    updated: 0,
    error: null,
    skipped: [{ row: 3, reason: 'нет заголовка' }],
    warnings: [{ row: 2, message: 'исполнитель «x» не найден' }],
  };
  return {
    tr: (k: string) => k,
    useProjects: () => ref([{ id: 'p1', name: 'Proj', spaceId: 's1' }]),
    useStatuses: () =>
      ref([
        { id: 'st1', name: 'Todo', spaceId: 's1', rank: 'a0' },
        { id: 'st2', name: 'Done', spaceId: 's1', rank: 'a1' },
      ]),
    previewFile: vi.fn(async () => ({
      columns: ['Title', 'Status'],
      rows: [
        ['A', 'todo'],
        ['B', 'Done'],
        ['C', 'todo'],
      ],
      mapping: { title: 'Title', status: 'Status' },
    })),
    startJob: vi.fn(async () => ({ ...job, status: 'pending', processed: 0 })),
    getJob: vi.fn(async () => job),
  };
});

import * as data from '../../../../../../modules/import/web/data';
import { web } from '../../../../../../modules/import/web';
import ImportPage from '../../../../../../modules/import/web/ImportPage.vue';
import {
  buildMapping,
  guessStatus,
  presetsFor,
  statusValues,
} from '../../../../../../modules/import/web/lib';

describe('wk6: web импорта', () => {
  it('wk6: манифест — маршрут /m/import/, пункт навигации и команда import:open', () => {
    expect(web.id).toBe('import');
    expect(web.routes?.[0]?.path).toBe('/m/import/');
    expect(web.nav?.[0]).toMatchObject({ to: '/m/import/' });
    expect(web.commands?.map((c) => c.id)).toEqual(['import:open']);
  });

  it('wk6b: import:open переходит через router.push', () => {
    void web.commands![0]!.run({ route: {} as never, selectedTaskIds: [] });
    expect(push).toHaveBeenCalledWith('/m/import/');
  });

  it('wk6: lib — значения статусов, mapping без пустых полей, подсказка статуса, заготовки формата', () => {
    expect(
      statusValues(
        ['T', 'S'],
        [
          ['a', 'x'],
          ['b', 'x'],
          ['c', ''],
        ],
        'S',
      ),
    ).toEqual(['x']);
    expect(statusValues(['T'], [['a']], undefined)).toEqual([]);
    expect(buildMapping({ title: 'T', status: 'S', labels: '' }, { x: 'id1', y: '' })).toEqual({
      title: 'T',
      status: 'S',
      statusMap: { x: 'id1' },
    });
    expect(buildMapping({ title: 'T' }, { x: 'id1' })).toEqual({ title: 'T' });
    expect(guessStatus('DONE', [{ id: 'd', name: 'Done' }])).toBe('d');
    expect(presetsFor('trello')).toEqual(['trello']);
    expect(presetsFor('csv')).toContain('jira');
  });

  it('wk6: мастер — файл → предпросмотр и сопоставление → прогресс и отчёт о пропусках', async () => {
    const w = mount(ImportPage);
    const input = w.get('input[type=file]');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.csv')] });
    await input.trigger('change');
    await w.get('.import-next').trigger('click');
    await flushPromises();
    expect(data.previewFile).toHaveBeenCalledWith(expect.any(File), 'csv', 'clickup');
    expect(w.findAll('.import-preview tbody tr')).toHaveLength(3);
    await w.get('.import-project').setValue('p1');
    expect(w.get('.import-start').attributes('disabled')).toBeUndefined();
    await w.get('.import-start').trigger('click');
    await flushPromises();
    expect(data.startJob).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        projectId: 'p1',
        preset: 'clickup',
        mapping: expect.objectContaining({ title: 'Title', status: 'Status' }),
      }),
    );
    expect(w.text()).toContain('нет заголовка');
    expect(w.text()).toContain('исполнитель');
    w.unmount();
  });
});
