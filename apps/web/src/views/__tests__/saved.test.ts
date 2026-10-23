import 'fake-indexeddb/auto';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import { mkUser } from '../../auth/__tests__/helpers';
import { useAuth } from '../../auth/useAuth';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { id, ids, reset, T } from '../../tasks/__tests__/data';
import { resetBreakpoint } from '../../ui';

const { router } = vi.hoisted(() => ({ router: { current: undefined as never } }));
vi.mock('../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  const r = vr.createRouter({
    history: vr.createMemoryHistory(),
    routes: [
      { path: '/p/:projectId/:view?', name: 'project', component: stub },
      { path: '/p/:projectId/v/:viewId', name: 'savedView', component: stub },
      { path: '/t/:key', name: 'task', component: stub },
    ],
  });
  router.current = r as never;
  return { router: r };
});
const stubView = defineComponent({
  props: ['projectId', 'options', 'filter'],
  setup: (p) => () =>
    h('div', {
      'data-testid': 'view',
      'data-options': JSON.stringify(p.options),
      'data-filter': JSON.stringify(p.filter ?? null),
    }),
});
vi.mock('../open', async (orig) => ({
  ...(await orig<typeof import('../open')>()),
  viewLoaders: () => ({
    '../views/list/View.vue': async () => ({ __esModule: true, default: stubView }),
    '../views/board/View.vue': async () => ({ __esModule: true, default: stubView }),
  }),
  taskPanelLoader: undefined,
}));

const ProjectScreen = (await import('../../screens/ProjectScreen.vue')).default;
const SavedViewScreen = (await import('../../screens/SavedViewScreen.vue')).default;
const r = router.current as import('vue-router').Router;
const body = new DOMWrapper(document.body);

const mounted: { unmount(): void }[] = [];
const mountScreen = (c: object) => {
  const w = mount(c, {
    attachTo: document.body,
    global: {
      plugins: [r, createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })],
    },
  });
  mounted.push(w);
  return w;
};
const savedRow = (over: Record<string, unknown> = {}) => ({
  id: id(),
  spaceId: ids.space,
  userId: null,
  createdBy: ids.ann,
  name: 'Вид',
  layout: 'board',
  filter: { op: 'and', rules: [{ field: 'priority', operator: 'in', value: [1] }] },
  config: { groupBy: 'priority', sortDir: 'desc', unknown: 1 },
  rank: 'a1',
  createdAt: T,
  updatedAt: T,
  ...over,
});
const tabs = (w: ReturnType<typeof mountScreen>) =>
  w.findAll('[data-saved-view]').map((x) => x.text());
const rows = () => db.table('savedViews').toArray();
const until = (f: () => Promise<unknown> | unknown) =>
  vi.waitFor(async () => expect(await f()).toBeTruthy());

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {} }) as never;
  resetBreakpoint();
  localStorage.clear();
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
  useAuth().user.value = mkUser({ id: ids.ann });
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
});

describe('views:saved', () => {
  it('views:saved «Сохранить как вид» — личный: view.create personal, layout, config, filter', async () => {
    await r.push(`/p/${ids.project}/board`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=save-as-view]').exists());
    await w.get('[data-testid=filter-toggle]').trigger('click');
    await w.get('[data-role=add]').trigger('click');
    await w.get('[data-role=operator]').setValue('notIn');
    await w.get('[data-testid=fields-toggle]').trigger('click');
    await w.get('[data-field=labels]').setValue(false);
    await w.get('[data-testid=save-as-view]').trigger('click');
    await until(() => body.find('input[type=text]').exists());
    await body.get('input[type=text]').setValue('Мой вид');
    await body.get('[data-testid=save-view-submit]').trigger('click');
    await until(async () => (await rows()).length === 1);
    const [v] = await rows();
    expect(v).toMatchObject({
      name: 'Мой вид',
      userId: ids.ann,
      spaceId: ids.space,
      layout: 'board',
      filter: { op: 'and', rules: [{ field: 'status', operator: 'notIn' }] },
    });
    expect(v.config.fields).toEqual(['status', 'assignee', 'priority', 'dueDate']);
    await until(() => r.currentRoute.value.path === `/p/${ids.project}/v/${v.id}`);
  });

  it('views:saved общий вид (personal:false) — userId null', async () => {
    await r.push(`/p/${ids.project}`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=save-as-view]').exists());
    await w.get('[data-testid=save-as-view]').trigger('click');
    await until(() => body.find('input[type=text]').exists());
    await body.get('input[type=text]').setValue('Общий');
    await body.get('input[type=radio][value=false]').setValue(true);
    await body.get('[data-testid=save-view-submit]').trigger('click');
    await until(async () => (await rows()).length === 1);
    expect((await rows())[0]).toMatchObject({ name: 'Общий', userId: null });
  });

  it('views:saved общий виден другому участнику, чужой личный — нет', async () => {
    await db
      .table('savedViews')
      .bulkPut([
        savedRow({ name: 'Общий', rank: 'a1' }),
        savedRow({ name: 'Мой', userId: ids.ann, rank: 'a2' }),
        savedRow({ name: 'Чужой', userId: ids.bob, rank: 'a3' }),
      ]);
    await r.push(`/p/${ids.project}`);
    const w = mountScreen(ProjectScreen);
    await until(() => tabs(w).length === 2);
    expect(tabs(w)).toEqual(['Общий', 'Мой']);
    useAuth().user.value = mkUser({ id: ids.bob });
    await until(() => tabs(w).join() === 'Общий,Чужой');
  });

  it('views:saved /p/:id/v/:viewId — вид получает config (с умолчаниями) и filter', async () => {
    const v = savedRow();
    await db.table('savedViews').put(v);
    await r.push(`/p/${ids.project}/v/${v.id}`);
    const w = mountScreen(SavedViewScreen);
    await until(() => w.find('[data-testid=view]').exists());
    const el = w.get('[data-testid=view]');
    expect(JSON.parse(el.attributes('data-options')!)).toEqual({
      groupBy: 'priority',
      sortBy: 'rank',
      sortDir: 'desc',
      showSubtasks: false,
      fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
    });
    expect(JSON.parse(el.attributes('data-filter')!)).toEqual(v.filter);
  });

  it('views:saved правки — черновик; «Сохранить» → view.update, «Сбросить» возвращает', async () => {
    const v = savedRow({ userId: ids.ann });
    await db.table('savedViews').put(v);
    await r.push(`/p/${ids.project}/v/${v.id}`);
    const w = mountScreen(SavedViewScreen);
    await until(() => w.find('[data-testid=view]').exists());
    expect(w.find('[data-testid=saved-save]').exists()).toBe(false);
    const dir = () => JSON.parse(w.get('[data-testid=view]').attributes('data-options')!).sortDir;
    await w.get('[aria-label="Порядок сортировки"]').trigger('click');
    expect(dir()).toBe('asc');
    expect((await rows())[0].config.sortDir).toBe('desc'); // в реплике пока старое
    await w.get('[data-testid=saved-reset]').trigger('click');
    expect(dir()).toBe('desc');
    await w.get('[aria-label="Порядок сортировки"]').trigger('click');
    await w.get('[data-testid=saved-save]').trigger('click');
    await flushPromises();
    await until(async () => (await rows())[0].config.sortDir === 'asc');
    await until(() => !w.find('[data-testid=saved-save]').exists());
  });

  it('polish: views:saved чужой личный вид не правится', async () => {
    const v = savedRow({ userId: ids.bob });
    await db.table('savedViews').put(v);
    await r.push(`/p/${ids.project}/v/${v.id}`);
    const w = mountScreen(SavedViewScreen);
    await until(() => w.find('[data-testid=view]').exists());
    await w.get('[aria-label="Порядок сортировки"]').trigger('click');
    await until(() => w.find('[data-testid=saved-reset]').exists());
    expect(w.find('[data-testid=saved-save]').exists()).toBe(false);
  });

  it('polish: views:saved optionsFrom — fields не массив или с неизвестными значениями', async () => {
    const { optionsFrom, DEFAULT_OPTIONS } = await import('../options');
    expect(optionsFrom({ fields: 'status' }).fields).toEqual(DEFAULT_OPTIONS.fields);
    expect(optionsFrom({ fields: ['status', 'bogus', 3] }).fields).toEqual(['status']);
  });
});
