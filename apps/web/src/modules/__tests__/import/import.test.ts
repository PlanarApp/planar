import Select from '../../../ui/Select.vue';
import { i18n } from '../../../i18n';
import UserPicker from '../../../pickers/UserPicker.vue';
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
    useSpaces: () =>
      ref([
        { id: 's1', name: 'Space', rank: 'a0' },
        { id: 's2', name: 'Empty', rank: 'a1' },
      ]),
    useProjects: () => ref([{ id: 'p1', name: 'Proj', key: 'PRJ', spaceId: 's1' }]),
    useUsers: () => ref([{ id: 'u1', name: 'Alice', login: 'alice', deactivatedAt: null }]),
    useSession: () => ref({ id: 'u1', role: 'admin' }),
    useStatuses: () =>
      ref([
        { id: 'st1', name: 'Todo', spaceId: 's1', projectId: 'p1', rank: 'a0' },
        { id: 'st2', name: 'Done', spaceId: 's1', projectId: 'p1', rank: 'a1' },
      ]),
    previewFile: vi.fn(async () => ({
      columns: ['Title', 'Status'],
      rows: [
        ['A', 'todo'],
        ['B', 'Done'],
        ['C', 'todo'],
      ],
      mapping: { title: 'Title', status: 'Status' },
      values: { status: ['todo', 'Done', 'Later'], project: [], people: [] },
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
  guessProject,
  guessStatus,
  guessUser,
  presetsFor,
} from '../../../../../../modules/import/web/lib';

describe('wk6: web импорта', () => {
  it('wk6: манифест — маршрут /m/import/, пункт навигации и команда import:open', () => {
    expect(web.id).toBe('import');
    expect(web.routes?.[0]?.path).toBe('/m/import/');
    expect(web.settings?.[0]).toMatchObject({ id: 'import' }); // workspace settings section
    expect(web.commands?.map((c) => c.id)).toEqual(['import:open']);
  });

  it('wk6b: import:open переходит через router.push', () => {
    void web.commands![0]!.run({ route: {} as never, selectedTaskIds: [] });
    expect(push).toHaveBeenCalledWith('/m/import/');
  });

  it('plane: lib — projectMap/userMap только с колонкой; подсказки проекта и человека', () => {
    expect(
      buildMapping(
        { title: 'T', project: 'P', comments: 'C' },
        {},
        { projects: { A: 'new', B: '' }, people: { 'G L': 'u1', X: '' } },
      ),
    ).toEqual({
      title: 'T',
      project: 'P',
      comments: 'C',
      projectMap: { A: 'new' },
      userMap: { 'G L': 'u1' },
    });
    expect(
      buildMapping({ title: 'T' }, {}, { projects: { A: 'new' }, people: { x: 'u' } }),
    ).toEqual({ title: 'T' });
    const ps = [
      { id: 'p1', name: 'Engineering', key: 'ENG' },
      { id: 'p2', name: 'Tech', key: 'OTHER' },
    ];
    expect(guessProject({ name: 'x', key: 'eng' }, ps)).toBe('p1');
    expect(guessProject({ name: 'TECH', key: 'TECH' }, ps)).toBe('p2');
    expect(guessProject({ name: 'Nope', key: null }, ps)).toBe('new');
    const us = [{ id: 'u1', name: 'Andrey Z.', login: 'az', email: 'a@x.io' }];
    expect(guessUser('andrey z.', us)).toBe('u1');
    expect(guessUser('A@X.io', us)).toBe('u1');
    expect(guessUser('G L', us)).toBe('');
    expect(guessUser('G L', us, true)).toBe('new'); // an instance admin — create by default
  });

  it('статусы: подсказка «создать» с категорией по имени; statusMap и statusNew раздельно', () => {
    expect(guessStatus('Test dev', [])).toBe('new:in_progress');
    expect(guessStatus('К работе', [])).toBe('new:todo');
    expect(guessStatus('Cancelled', [])).toBe('new:cancelled');
    expect(guessStatus('Need discuss', [])).toBe('new:todo'); // unknown → todo
    expect(buildMapping({ title: 'T', status: 'S' }, { a: 'id1', b: 'new:done', c: '' })).toEqual({
      title: 'T',
      status: 'S',
      statusMap: { a: 'id1' },
      statusNew: { b: 'done' },
    });
  });

  it('wk6: lib — mapping без пустых полей, подсказка статуса, заготовки формата', () => {
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
    const w = mount(ImportPage, { global: { plugins: [i18n] } });
    const input = w.get('input[type=file]');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.csv')] });
    await input.trigger('change');
    await w.get('.import-next').trigger('click');
    await flushPromises();
    expect(data.previewFile).toHaveBeenCalledWith(expect.any(File), 'csv', 'clickup');
    expect(w.findAll('.import-preview tbody tr')).toHaveLength(3);
    expect(w.find('.import-project').exists()).toBe(false); // the space first
    w.get('.import-space').getComponent(Select).vm.$emit('update:modelValue', 's1');
    await w.vm.$nextTick();
    expect(w.get('.import-start').attributes('disabled')).toBeDefined(); // no project column — a project is required
    w.get('.import-project').getComponent(Select).vm.$emit('update:modelValue', 'p1');
    await w.vm.$nextTick();
    // statuses — over the whole file (values), not only the preview rows
    expect(w.findAll('.import-status > span').map((e) => e.text())).toEqual([
      'todo',
      'Done',
      'Later',
    ]);
    expect(w.get('.import-start').attributes('disabled')).toBeUndefined();
    await w.get('.import-start').trigger('click');
    await flushPromises();
    expect(data.startJob).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        spaceId: 's1',
        projectId: 'p1',
        preset: 'clickup',
        mapping: expect.objectContaining({
          title: 'Title',
          status: 'Status',
          statusMap: { todo: 'st1', Done: 'st2' },
          statusNew: { Later: 'backlog' },
        }),
      }),
    );
    expect(w.text()).toContain('нет заголовка');
    expect(w.text()).toContain('исполнитель');
    w.unmount();
  });

  it('пустое пространство: без проекта по колонке проекта — проекты и люди «создать»', async () => {
    vi.mocked(data.previewFile).mockResolvedValueOnce({
      columns: ['Name', 'Project', 'Assignees'],
      rows: [['A', 'Eng', '["G L"]']],
      mapping: { title: 'Name', project: 'Project', assignee: 'Assignees' },
      values: { status: [], project: [{ name: 'Eng', key: 'ENG' }], people: ['G L', 'Alice'] },
    });
    vi.mocked(data.startJob).mockClear();
    const w = mount(ImportPage, { global: { plugins: [i18n] } });
    const input = w.get('input[type=file]');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.json')] });
    await input.trigger('change');
    await w.get('.import-next').trigger('click');
    await flushPromises();
    w.get('.import-space').getComponent(Select).vm.$emit('update:modelValue', 's2');
    await w.vm.$nextTick();
    expect(w.get('.import-start').attributes('disabled')).toBeUndefined();
    await w.get('.import-start').trigger('click');
    await flushPromises();
    expect(data.startJob).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        spaceId: 's2',
        projectId: '',
        mapping: expect.objectContaining({
          projectMap: { Eng: 'new' },
          userMap: { 'G L': 'new', Alice: 'u1' },
        }),
      }),
    );
    w.unmount();
  });

  it('PLNRAPP-827: люди файла сопоставляются общим UserPicker — «Создать нового», «нет», человек', async () => {
    vi.mocked(data.previewFile).mockResolvedValueOnce({
      columns: ['Name', 'Assignees'],
      rows: [['A', '["G L"]']],
      mapping: { title: 'Name', assignee: 'Assignees' },
      values: { status: [], project: [], people: ['G L', 'Alice', 'Bob'] },
    });
    vi.mocked(data.startJob).mockClear();
    const w = mount(ImportPage, { global: { plugins: [i18n] } });
    const input = w.get('input[type=file]');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.json')] });
    await input.trigger('change');
    await w.get('.import-next').trigger('click');
    await flushPromises();
    w.get('.import-space').getComponent(Select).vm.$emit('update:modelValue', 's1');
    await w.vm.$nextTick();
    w.get('.import-project').getComponent(Select).vm.$emit('update:modelValue', 'p1');
    await w.vm.$nextTick();
    const pickers = w.findAll('.import-person').map((r) => r.getComponent(UserPicker));
    expect(pickers).toHaveLength(3);
    // admin: the «create new» item; the guess for an unknown name is «create», for Alice — her
    expect(pickers[0]!.props()).toMatchObject({
      create: 'createNew',
      creating: true,
      none: 'noMatch',
    });
    expect(pickers[1]!.props('selected')).toEqual(['u1']);
    pickers[0]!.vm.$emit('pick', 'u1');
    pickers[1]!.vm.$emit('pick', null);
    pickers[2]!.vm.$emit('create');
    await w.vm.$nextTick();
    await w.get('.import-start').trigger('click');
    await flushPromises();
    expect(data.startJob).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        mapping: expect.objectContaining({ userMap: { 'G L': 'u1', Bob: 'new' } }),
      }),
    );
    w.unmount();
  });
});
