import 'fake-indexeddb/auto';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from 'reka-ui';
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
const r = router.current as import('vue-router').Router;
const body = new DOMWrapper(document.body);

const mounted: { unmount(): void }[] = [];
const mountScreen = (c: object) => {
  const w = mount(defineComponent({ render: () => h(TooltipProvider, null, () => h(c)) }), {
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

// "Save view" is in the "…" menu of the panel; Enter opens reka DropdownMenu in jsdom
async function openSaveMenu(w: ReturnType<typeof mountScreen>) {
  const trigger = await vi.waitFor(() => w.get('button[aria-label=Ещё]'));
  trigger.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await flushPromises();
  await until(() => body.find('[role=menuitem]').exists());
  await body.get('[role=menuitem]').trigger('click');
}

// the view controls are in the "View" popover; open it if it is still closed
async function flipSortDir(w: ReturnType<typeof mountScreen>) {
  const sel = '[aria-label="Порядок сортировки"]';
  if (!body.find(sel).exists()) {
    await until(() => w.find('[data-testid=view-toggle]').exists());
    await w.get('[data-testid=view-toggle]').trigger('click');
    await until(() => body.find(sel).exists());
  }
  await body.get(sel).trigger('click');
}

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
    await until(() => w.find('[data-testid=filter-toggle]').exists());
    await w.get('[data-testid=filter-toggle]').trigger('click');
    await until(() => body.find('[data-role=add]').exists());
    await body.get('[data-role=add]').trigger('click');
    await body.get('[data-role=operator]').setValue('notIn');
    expect(w.find('[data-testid=filter-active]').exists()).toBe(true);
    expect(w.find('[data-testid=filter-chip]').exists()).toBe(false);
    await w.get('[data-testid=filter-toggle]').trigger('click');
    await w.get('[data-testid=view-toggle]').trigger('click');
    await until(() => body.find('[data-field=labels]').exists());
    await body.get('[data-field=labels]').setValue(false);
    await w.get('[data-testid=view-toggle]').trigger('click');
    await openSaveMenu(w);
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

  const hideLabels = async (w: ReturnType<typeof mountScreen>) => {
    await until(() => w.find('[data-testid=view-toggle]').exists());
    await w.get('[data-testid=view-toggle]').trigger('click');
    await until(() => body.find('[data-field=labels]').exists());
    await body.get('[data-field=labels]').setValue(false);
    await w.get('[data-testid=view-toggle]').trigger('click');
  };
  const fieldsOf = (w: ReturnType<typeof mountScreen>) =>
    JSON.parse(w.get('[data-testid=view]').attributes('data-options')!).fields as string[];

  it('PJ-4 вид таба узла: правка сразу уходит в мою строку node (без черновика), после открытия — из неё', async () => {
    await r.push(`/p/${ids.project}/board`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=view-toggle]').exists());
    expect(w.find('[data-testid=node-reset]').exists()).toBe(false);
    await hideLabels(w);
    await until(async () => (await rows()).length === 1);
    const [v] = await rows();
    expect(v).toMatchObject({ node: `p:${ids.project}`, layout: 'board', userId: ids.ann });
    expect(v.config.fields).not.toContain('labels');
    await until(() => w.find('[data-testid=node-reset]').exists());
    expect(w.find('[data-testid=saved-save]').exists()).toBe(false);
    // the node view is not a named tab
    expect(w.find(`[data-saved-view="${v.id}"]`).exists()).toBe(false);
    w.unmount();
    // opened again — the saved view
    const w2 = mountScreen(ProjectScreen);
    await until(() => w2.find('[data-testid=view-toggle]').exists());
    await w2.get('[data-testid=view-toggle]').trigger('click');
    await until(() => body.find('[data-field=labels]').exists());
    expect((body.get('[data-field=labels]').element as HTMLInputElement).checked).toBe(false);
  });

  it('PJ-4 несколько правок подряд — одна строка (id стабилен), вторая правка — view.update', async () => {
    await r.push(`/p/${ids.project}/board`);
    const w = mountScreen(ProjectScreen);
    await hideLabels(w);
    await until(async () => (await rows()).length === 1);
    const [v] = await rows();
    await flipSortDir(w);
    await until(async () => (await rows())[0].config.sortDir !== v.config.sortDir);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].id).toBe(v.id);
  });

  it('PJ-4 общий вид по умолчанию виден, «Сбросить» возвращает его после личной правки', async () => {
    const shared = savedRow({
      node: `p:${ids.project}`,
      config: { fields: ['status'] },
      filter: { op: 'and', rules: [] },
    });
    await db.table('savedViews').put(shared);
    await r.push(`/p/${ids.project}/board`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=view]').exists());
    expect(fieldsOf(w)).toEqual(['status']);
    expect(w.find('[data-testid=node-reset]').exists()).toBe(false);
    await flipSortDir(w);
    await until(async () => (await rows()).length === 2);
    await until(() => w.find('[data-testid=node-reset]').exists());
    await w.get('[data-testid=node-reset]').trigger('click');
    await until(async () => (await rows()).length === 1);
    expect((await rows())[0].id).toBe(shared.id);
    await until(() => !w.find('[data-testid=node-reset]').exists());
    expect(fieldsOf(w)).toEqual(['status']);
  });

  it('PJ-4 «Сохранить для всех» — общая строка (userId null) вместо моей личной', async () => {
    await r.push(`/p/${ids.project}/board`);
    const w = mountScreen(ProjectScreen);
    await hideLabels(w);
    await until(async () => (await rows()).length === 1);
    await until(() => w.find('[data-testid=node-share]').exists());
    await w.get('[data-testid=node-share]').trigger('click');
    await until(async () => (await rows()).length === 1 && (await rows())[0].userId === null);
    expect((await rows())[0]).toMatchObject({ node: `p:${ids.project}`, layout: 'board' });
    expect((await rows())[0].config.fields).not.toContain('labels');
    await until(() => !w.find('[data-testid=node-reset]').exists());
  });

  it('PJ-4 личный вид другого пользователя не виден', async () => {
    await db
      .table('savedViews')
      .put(savedRow({ node: `p:${ids.project}`, userId: ids.bob, config: { fields: ['status'] } }));
    await r.push(`/p/${ids.project}/board`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=view]').exists());
    expect(fieldsOf(w)).not.toEqual(['status']);
    expect(w.find('[data-testid=node-reset]').exists()).toBe(false);
  });

  it('pj25: кнопка фильтра — отметка и подсказка, пустой фильтр без них', async () => {
    await r.push(`/p/${ids.project}`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=filter-toggle]').exists());
    expect(w.find('[data-testid=filter-active]').exists()).toBe(false);
    expect(w.get('[data-testid=filter-toggle]').attributes('title')).toBeUndefined();
    await w.get('[data-testid=filter-toggle]').trigger('click');
    await until(() => body.find('[data-role=add]').exists());
    await body.get('[data-role=add]').trigger('click');
    await until(() => w.find('[data-testid=filter-active]').exists());
    expect(w.get('[data-testid=filter-toggle]').attributes('title')).toBeTruthy();
  });

  it('views:saved общий вид (personal:false) — userId null', async () => {
    await r.push(`/p/${ids.project}`);
    const w = mountScreen(ProjectScreen);
    await openSaveMenu(w);
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
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=view]').exists());
    const el = w.get('[data-testid=view]');
    expect(JSON.parse(el.attributes('data-options')!)).toEqual({
      groupBy: 'priority',
      sortBy: 'rank',
      sortDir: 'desc',
      showSubtasks: false,
      showEmpty: false,
      wrapTitles: false,
      showKey: false,
      me: null,
      fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
    });
    expect(JSON.parse(el.attributes('data-filter')!)).toEqual(v.filter);
  });

  it('views:saved правки — черновик; «Сохранить» → view.update, «Сбросить» возвращает', async () => {
    const v = savedRow({ userId: ids.ann });
    await db.table('savedViews').put(v);
    await r.push(`/p/${ids.project}/v/${v.id}`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=view]').exists());
    expect(w.find('[data-testid=saved-save]').exists()).toBe(false);
    const dir = () => JSON.parse(w.get('[data-testid=view]').attributes('data-options')!).sortDir;
    await flipSortDir(w);
    expect(dir()).toBe('asc');
    expect((await rows())[0].config.sortDir).toBe('desc'); // the replica still has the old value
    await w.get('[data-testid=saved-reset]').trigger('click');
    expect(dir()).toBe('desc');
    await flipSortDir(w);
    await w.get('[data-testid=saved-save]').trigger('click');
    await flushPromises();
    await until(async () => (await rows())[0].config.sortDir === 'asc');
    await until(() => !w.find('[data-testid=saved-save]').exists());
  });

  it('polish: views:saved чужой личный вид не правится', async () => {
    const v = savedRow({ userId: ids.bob });
    await db.table('savedViews').put(v);
    await r.push(`/p/${ids.project}/v/${v.id}`);
    const w = mountScreen(ProjectScreen);
    await until(() => w.find('[data-testid=view]').exists());
    await flipSortDir(w);
    await until(() => w.find('[data-testid=saved-reset]').exists());
    expect(w.find('[data-testid=saved-save]').exists()).toBe(false);
  });

  it('polish: views:saved optionsFrom — fields не массив или с неизвестными значениями', async () => {
    const { optionsFrom, DEFAULT_OPTIONS } = await import('../options');
    expect(optionsFrom({ fields: 'status' }).fields).toEqual(DEFAULT_OPTIONS.fields);
    expect(optionsFrom({ fields: ['status', 'bogus', 3] }).fields).toEqual(['status']);
  });
});
