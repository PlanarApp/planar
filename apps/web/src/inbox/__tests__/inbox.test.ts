import 'fake-indexeddb/auto';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, effectScope, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { domainMutators, uuidv7 } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { useAuth } from '../../auth/useAuth';
import { mkUser } from '../../auth/__tests__/helpers';
import { TooltipProvider } from 'reka-ui';
import { resetBreakpoint } from '../../ui';

const { router } = vi.hoisted(() => ({ router: { current: undefined as never } }));
vi.mock('../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  const r = vr.createRouter({
    history: vr.createMemoryHistory(),
    routes: [
      { path: '/t/:key', name: 'task', component: stub },
      { path: '/:p(.*)*', component: stub },
    ],
  });
  router.current = r as never;
  return { router: r };
});

// task form is a stub: we only check which task the split opened
vi.mock('../../views/open', async (orig) => ({
  ...(await orig<typeof import('../../views/open')>()),
  taskPanelLoader: async () => ({
    __esModule: true, // defineAsyncComponent takes default only from the module
    default: {
      props: ['taskKey'],
      setup: (p: { taskKey: string }) => () => h('div', { 'data-testid': 'panel' }, p.taskKey),
    },
  }),
}));

const InboxScreen = (await import('../../screens/InboxScreen.vue')).default;
const BellMenu = (await import('../BellMenu.vue')).default;
const MyDay = (await import('../MyDay.vue')).default;
const { setDue } = await import('../myDay');
const { useTaskFilter } = await import('../../views/saved/useFilter');
const PushToggle = (await import('../PushToggle.vue')).default;
const { useUnread, useAssignedComments, useMyTasks } = await import('../queries');
const { snoozed } = await import('../snooze');
const push = await import('../push');

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const g = { plugins: [i18n] };
const route = () =>
  (router.current as { currentRoute: { value: { path: string; query: Record<string, unknown> } } })
    .currentRoute.value;
function mockMq(mobile: boolean) {
  resetBreakpoint();
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('max-width') ? mobile : false,
    addEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
const me = uuidv7();
const bob = uuidv7();
const space = uuidv7();
const project = uuidv7();
const sTodo = uuidv7();
const sDone = uuidv7();
const day = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const ts = (h: number) => new Date(Date.now() - h * 36e5).toISOString();

const task = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  projectId: project,
  spaceId: space,
  statusId: sTodo,
  number: 1,
  title: 't',
  dueDate: null,
  ...o,
});
const note = (id: string, taskId: string, o: Record<string, unknown> = {}) => ({
  id,
  userId: me,
  spaceId: space,
  kind: 'assigned',
  taskId,
  url: null,
  body: null,
  commentId: null,
  actorId: bob,
  readAt: null,
  createdAt: ts(1),
  ...o,
});

beforeAll(() => registerMutators(domainMutators));
// live queries of a left-mounted screen re-render after jsdom teardown → unhandled rejection
enableAutoUnmount(afterEach);
beforeEach(async () => {
  await stopSync();
  for (const t of db.tables) await t.clear();
  localStorage.clear();
  mockMq(false);
  snoozed.value = {};
  useAuth().user.value = mkUser({ id: me });
  await startSync({ userId: me, fetch: (() => Promise.reject(new TypeError('offline'))) as never });
  await db.table('users').bulkPut([{ id: bob, name: 'Bob' }]);
  await db.table('projects').bulkPut([{ id: project, key: 'PL', name: 'Planar' }]);
  await db.table('statuses').bulkPut([
    { id: sTodo, name: 'Открыта', category: 'todo', color: '#000' },
    { id: sDone, name: 'Готово', category: 'done', color: '#000' },
  ]);
});

describe('inbox:list', () => {
  const t1 = uuidv7();
  const t2 = uuidv7();
  const seed = async () => {
    await db.table('tasks').bulkPut([task(t1, { number: 1 }), task(t2, { number: 2 })]);
  };
  it('inbox:list сортирует по времени и группирует по дням', async () => {
    await seed();
    await db
      .table('notifications')
      .bulkPut([
        note(uuidv7(), t1, { createdAt: ts(50) }),
        note(uuidv7(), t2, { createdAt: ts(1) }),
      ]);
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=inbox-item]')).toHaveLength(2));
    expect(w.findAll('h2').length).toBe(2);
    expect(w.findAll('[data-testid=inbox-item]')[0].text()).toContain('PL-2');
    expect(w.findAll('[data-testid=inbox-item]')[0].text()).toContain('Bob');
  });
  it('inbox:list клик читает и открывает задачу (мобильный — страница)', async () => {
    mockMq(true);
    await seed();
    const id = uuidv7();
    await db.table('notifications').bulkPut([note(id, t1)]);
    // on mobile the card's "…" menu has a hint
    const w = mount(
      defineComponent({ render: () => h(TooltipProvider, null, () => h(InboxScreen)) }),
      { global: g },
    );
    await vi.waitFor(() => expect(w.find('[data-testid=inbox-item]').exists()).toBe(true));
    await w.find('[data-testid=inbox-item] button').trigger('click');
    await vi.waitFor(async () =>
      expect((await db.table('notifications').get(id)).readAt).toBeTruthy(),
    );
    await vi.waitFor(() => expect(route().path).toBe('/t/PL-1'));
  });
  it('PLANARAPP-35 галка «Прочитано» — без перехода к задаче', async () => {
    await seed();
    const id = uuidv7();
    await db.table('notifications').bulkPut([note(id, t1)]);
    const w = mount(
      defineComponent({ render: () => h(TooltipProvider, null, () => h(InboxScreen)) }),
      { global: g },
    );
    const path = route().path;
    await vi.waitFor(() => expect(w.find('[data-testid=inbox-read]').exists()).toBe(true));
    await w.find('[data-testid=inbox-read]').trigger('click');
    await vi.waitFor(async () =>
      expect((await db.table('notifications').get(id)).readAt).toBeTruthy(),
    );
    await vi.waitFor(() => expect(w.find('[data-testid=inbox-read]').exists()).toBe(false));
    expect(route().path).toBe(path);
  });
  it('inbox:list уведомления задачи — одна карточка; действия на все', async () => {
    await seed();
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    await db
      .table('notifications')
      .bulkPut([
        note(a, t1, { createdAt: ts(3) }),
        note(b, t1, { kind: 'status_changed', changes: { statusId: [sTodo, sDone] } }),
        note(c, null as never, { kind: 'chat_dm', body: 'Bob: привет', createdAt: ts(2) }),
      ]);
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=inbox-item]')).toHaveLength(2));
    const card = w.findAll('[data-testid=inbox-item]')[0];
    expect(card.findAll('[data-testid=inbox-change]')).toHaveLength(2);
    expect(card.text()).toMatch(/Открыта.*Готово/);
    expect(w.findAll('[data-testid=inbox-item]')[1].text()).toContain('привет');
    await card.find('button').trigger('click');
    await vi.waitFor(async () =>
      expect((await db.table('notifications').bulkGet([a, b])).every((n) => n.readAt)).toBe(true),
    );
    expect((await db.table('notifications').get(c)).readAt).toBeNull();
  });
  it('inbox:list комментарий виден текстом', async () => {
    await seed();
    const cm = uuidv7();
    await db.table('comments').put({
      id: cm,
      taskId: t1,
      spaceId: space,
      authorId: bob,
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Посмотри макет' }] }],
      },
      createdAt: ts(1),
    });
    await db.table('notifications').put(note(uuidv7(), t1, { kind: 'commented', commentId: cm }));
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.text()).toContain('Посмотри макет'));
  });
  it('inbox:list десктоп — задача открывается справа (?task)', async () => {
    await (router.current as { push: (p: string) => Promise<unknown> }).push('/inbox');
    await seed();
    await db.table('notifications').put(note(uuidv7(), t1));
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.find('[data-testid=inbox-item]').exists()).toBe(true));
    await w.find('[data-testid=inbox-item] button').trigger('click');
    await vi.waitFor(() => expect(route().query.open).toBe('PL-1'));
    expect(route().path).toBe('/inbox');
    await vi.waitFor(() => expect(w.find('[data-testid=panel]').text()).toBe('PL-1'));
  });
  it('inbox:list «прочитать все»', async () => {
    await seed();
    await db.table('notifications').bulkPut([note(uuidv7(), t1), note(uuidv7(), t2)]);
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=inbox-item]')).toHaveLength(2));
    await w
      .findAll('button')
      .find((b) => b.text() === ru.inbox.readAll)!
      .trigger('click');
    await vi.waitFor(async () =>
      expect((await db.table('notifications').toArray()).every((n) => n.readAt)).toBe(true),
    );
  });
  it('PLNRAPP-247 тысячи карточек — по 100, «ещё N» догружает', async () => {
    await db
      .table('notifications')
      .bulkPut(
        Array.from({ length: 130 }, () =>
          note(uuidv7(), null as never, { kind: 'chat_dm', body: 'Bob: привет' }),
        ),
      );
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=inbox-item]')).toHaveLength(100));
    expect(w.find('[data-testid=inbox-more]').text()).toBe(ru.inbox.more.replace('{n}', '30'));
    await w.find('[data-testid=inbox-more]').trigger('click');
    await vi.waitFor(() => expect(w.findAll('[data-testid=inbox-item]')).toHaveLength(130));
    expect(w.find('[data-testid=inbox-more]').exists()).toBe(false);
  });
  it('PLNRAPP-247 колокольчик «прочитать все» — одной мутацией, отложенное остаётся', async () => {
    await seed();
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    await db.table('notifications').bulkPut([note(a, t1), note(b, t2), note(c, t2)]);
    snoozed.value = { [c]: new Date(Date.now() + 36e5).toISOString() };
    const w = mount(
      defineComponent({ render: () => h(TooltipProvider, null, () => h(BellMenu)) }),
      { global: g, attachTo: document.body },
    );
    await vi.waitFor(() => expect(w.find('[data-testid=bell-count]').text()).toBe('2'));
    await w.find('[data-testid=bell]').trigger('click');
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid=bell-read-all]')).toBeTruthy(),
    );
    (document.querySelector('[data-testid=bell-read-all]') as HTMLElement).click();
    await vi.waitFor(async () => {
      const [na, nb, nc] = await db.table('notifications').bulkGet([a, b, c]);
      expect([!!na.readAt, !!nb.readAt, !!nc.readAt]).toEqual([true, true, false]);
    });
    expect((await db.table('_queue').toArray()).map((q) => q.name)).toEqual([
      'notification.readAll',
    ]);
  });
  it('inbox:list отложенное скрыто до времени', async () => {
    await seed();
    const a = uuidv7();
    const b = uuidv7();
    await db.table('notifications').bulkPut([note(a, t1), note(b, t2)]);
    snoozed.value = {
      [a]: new Date(Date.now() + 36e5).toISOString(),
      [b]: new Date(Date.now() - 1000).toISOString(),
    };
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=inbox-item]')).toHaveLength(1));
    expect(w.text()).toContain('PL-2');
  });
});

// MyDay has icon buttons with tooltips: the app provides TooltipProvider at the root
const mountMy = () =>
  mount(
    defineComponent({
      render: () => h(TooltipProvider, null, () => h(MyDay, { projectIds: [project] })),
    }),
    { global: { plugins: [i18n, router.current] } },
  );

// PLNRAPP-709: there is no list under the «My day» planner, Me Mode 'day' is gone
describe('inbox:my', () => {
  it('сохранённый вид с бывшим Me Mode day — как без Me Mode', async () => {
    const statuses = await db.table('statuses').toArray();
    const scope = effectScope();
    const pred = scope.run(() => useTaskFilter(null, statuses, 'day' as never))!;
    const v = (o: Record<string, unknown>, assignee = me) =>
      ({ ...task(uuidv7(), o), assigneeIds: [assignee], labelIds: [] }) as never;
    expect(pred.value(v({ dueDate: day(30) }))).toBe(true);
    expect(pred.value(v({}, bob))).toBe(true);
    expect(pred.value(v({ statusId: sDone }))).toBe(true);
    scope.stop();
  });
  it('PLNRAPP-140 задача с моим открытым пунктом чек-листа — моя: «Назначенные», список «Комментарии для меня»', async () => {
    const tid = uuidv7();
    await db.table('tasks').put(task(tid, { number: 7, title: 'T7' }));
    const item = {
      id: uuidv7(),
      spaceId: space,
      taskId: tid,
      text: 'пункт',
      done: false,
      rank: 'a0',
      assigneeId: me,
      createdAt: ts(1),
      updatedAt: ts(1),
    };
    await db.table('checklistItems').put(item);
    const statuses = await db.table('statuses').toArray();
    const scope = effectScope();
    const [assigned, list] = scope.run(() => [
      useTaskFilter(null, statuses, 'assigned'),
      useAssignedComments(() => me),
    ])!;
    // the task itself is not assigned to me
    const t7 = { ...task(tid, {}), assigneeIds: [bob], labelIds: [] } as never;
    await vi.waitFor(() => expect(assigned.value(t7)).toBe(true));
    await vi.waitFor(() =>
      expect(list.value?.map((x) => [x.kind, x.key])).toEqual([['check', expect.any(String)]]),
    );
    // checked — no longer mine
    await db.table('checklistItems').put({ ...item, done: true });
    await vi.waitFor(() => expect(assigned.value(t7)).toBe(false));
    scope.stop();
  });
});

describe('PLNRAPP-485 созданные мной', () => {
  it('по индексу createdBy: мои, без архивных и чужих; запрос не читает всю таблицу', async () => {
    const [mine, archived, foreign] = [uuidv7(), uuidv7(), uuidv7()];
    await db
      .table('tasks')
      .bulkPut([
        task(mine, { number: 1, createdBy: me }),
        task(archived, { number: 2, createdBy: me, archivedAt: ts(1) }),
        task(foreign, { number: 3, createdBy: bob }),
      ]);
    const all = vi.spyOn(db.table('tasks'), 'toArray');
    const scope = effectScope();
    const rows = scope.run(() =>
      useMyTasks(
        () => me,
        () => 'created',
      ),
    )!;
    await vi.waitFor(() => expect(rows.value?.map((t) => t.id)).toEqual([mine]));
    expect(rows.value?.[0]).toMatchObject({ key: 'PL-1', status: { id: sTodo } });
    expect(all).not.toHaveBeenCalled();
    all.mockRestore();
    scope.stop();
  });
});

// PLNRAPP-709: the day is built from my tasks (assignee) by dueDate; the buttons change dueDate
describe('PLANARAPP-10 мой день', () => {
  const add = async (n: number, o: Record<string, unknown> = {}, mine = true) => {
    const id = uuidv7();
    // a full row: task.update validates the patched row
    await db.table('tasks').put(
      task(id, {
        number: n,
        title: `T${n}`,
        parentId: null,
        description: null,
        priority: 0,
        rank: `a${n}`,
        startDate: null,
        createdBy: me,
        completedAt: null,
        fields: {},
        cycleId: null,
        archivedAt: null,
        archivedBy: null,
        createdAt: ts(1),
        updatedAt: ts(1),
        ...o,
      }),
    );
    if (mine)
      await db.table('taskAssignees').put({ id: uuidv7(), taskId: id, userId: me, spaceId: space });
    return id;
  };
  const dueOf = async (id: string) => (await db.table('tasks').get(id))?.dueDate;
  const show = mountMy;
  const planned = (w: ReturnType<typeof show>, block = 'today') =>
    w
      .findAll(`[data-block=${block}] [data-testid=my-day-row]`)
      .map((r) => r.text().match(/T\d/)![0]);
  const click = async (el: { trigger: (e: string) => Promise<void> }) => {
    await el.trigger('click');
    await flushPromises();
  };
  // PLNRAPP-120: today / tomorrow / remove live in the date menu of the row (the popover is teleported to body)
  const act = async (w: ReturnType<typeof show>, scope: string, id: string) => {
    await click(w.find(`${scope} [data-testid=my-day-row] [aria-label="${ru.myDay.pick}"]`));
    await vi.waitFor(() => expect(document.querySelector(`[data-testid=${id}]`)).not.toBeNull());
    document.querySelector<HTMLElement>(`[data-testid=${id}]`)!.click();
    await flushPromises();
  };

  it('PLNRAPP-712: «Мой день» следует за dueDate задачи; в строке — «на завтра» и «убрать»', async () => {
    const t1 = await add(1);
    const t2 = await add(2);
    const w = show();
    await vi.waitFor(() => expect(w.find('[data-testid=my-day]').exists()).toBe(true));
    expect(w.find('[data-testid=my-day-row]').exists()).toBe(false);
    // no separate plan date (PLNRAPP-712): the task's due date alone puts it into the day
    await setDue(t2, day(0));
    await flushPromises();
    await vi.waitFor(() => expect(planned(w)).toEqual(['T2']));
    expect(await dueOf(t2)).toBe(day(0));
    await setDue(t1, day(0));
    // no manual order: by priority, then key
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1', 'T2']));
    await setDue(t1, day(1));
    await vi.waitFor(() => expect(planned(w, 'tomorrow')).toEqual(['T1']));
    expect(await dueOf(t1)).toBe(day(1));
    await setDue(t1, null);
    await vi.waitFor(() => expect(planned(w, 'tomorrow')).toEqual([]));
    expect(await dueOf(t1)).toBeNull();
    // the row's menu: remove clears dueDate, to tomorrow sets it
    await act(w, '[data-block=today]', 'my-day-tomorrow');
    await vi.waitFor(() => expect(planned(w)).toEqual([]));
    expect(planned(w, 'tomorrow')).toEqual(['T2']);
    expect(await dueOf(t2)).toBe(day(1));
    await act(w, '[data-block=tomorrow]', 'my-day-remove');
    await vi.waitFor(() => expect(planned(w, 'tomorrow')).toEqual([]));
    expect(await dueOf(t2)).toBeNull();
  });

  it('PLANARAPP-58: планер по dueDate — Сегодня, Завтра, Позже; чужие задачи и задачи без срока не попадают', async () => {
    const t1 = await add(1, { dueDate: day(0) });
    const t2 = await add(2, { dueDate: day(1) });
    const t3 = await add(3, { dueDate: day(5) });
    await add(4, { dueDate: day(0), statusId: sDone });
    await add(5);
    await add(6, { dueDate: day(0) }, false);
    const w = show();
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1', 'T4']));
    expect(planned(w, 'tomorrow')).toEqual(['T2']);
    expect(planned(w, 'later')).toEqual(['T3']);
    // later → today
    await act(w, '[data-block=later]', 'my-day-today');
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1', 'T3', 'T4']));
    expect(await dueOf(t3)).toBe(day(0));
    // unfinished of today → tomorrow; the done T4 stays
    await click(w.find('[data-testid=my-day-postpone]'));
    await vi.waitFor(() => expect(planned(w)).toEqual(['T4']));
    expect(planned(w, 'tomorrow')).toEqual(['T1', 'T2', 'T3']);
    expect([await dueOf(t1), await dueOf(t2), await dueOf(t3)]).toEqual([day(1), day(1), day(1)]);
  });

  it('сортировка: по dueDate, затем приоритет (без приоритета — в конце), затем ключ', async () => {
    await add(1, { dueDate: day(6) });
    await add(2, { dueDate: day(6), priority: 3 });
    await add(3, { dueDate: day(6), priority: 1 });
    await add(4, { dueDate: day(4) });
    await add(5, { dueDate: day(6), priority: 3 });
    const w = show();
    await vi.waitFor(() => expect(planned(w, 'later')).toEqual(['T4', 'T3', 'T2', 'T5', 'T1']));
  });

  it('просроченное незавершённое переносится на сегодня кнопкой; завершённое — нет', async () => {
    const open = await add(1, { dueDate: day(-2) });
    const done = await add(2, { dueDate: day(-1), statusId: sDone });
    const w = show();
    await vi.waitFor(() => expect(w.find('[data-testid=my-day-carry]').exists()).toBe(true));
    expect(w.find('[data-testid=my-day-carry]').text()).toContain('1');
    // not carried by itself: the due date stays until the button
    expect(planned(w)).toEqual([]);
    expect(await dueOf(open)).toBe(day(-2));
    await click(w.find('[data-testid=my-day-carry] button'));
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1']));
    expect(await dueOf(open)).toBe(day(0));
    expect(await dueOf(done)).toBe(day(-1));
    expect(w.find('[data-testid=my-day-carry]').exists()).toBe(false);
  });

  it('PLANARAPP-52: «Мой день» группы — только её проекты', async () => {
    const other = uuidv7();
    await db.table('projects').put({ id: other, key: 'QA', name: 'QA' });
    await add(1, { dueDate: day(0) });
    await add(2, { projectId: other, dueDate: day(0) });
    const view = (projectIds: string[]) =>
      mount(
        defineComponent({
          render: () => h(TooltipProvider, null, () => h(MyDay, { projectIds })),
        }),
        { global: { plugins: [i18n, router.current] } },
      );
    const one = view([project]);
    await vi.waitFor(() => expect(planned(one)).toEqual(['T1']));
    const both = view([project, other]);
    await vi.waitFor(() => expect(planned(both)).toEqual(['T1', 'T2']));
  });
});

describe('inbox:bell', () => {
  const Probe = { setup: () => ({ n: useUnread() }), template: '<i>{{ n }}</i>' };
  it('inbox:bell счётчик без отложенных', async () => {
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    const t = uuidv7();
    await db
      .table('notifications')
      .bulkPut([note(a, t), note(b, t), note(c, t, { readAt: ts(0) })]);
    snoozed.value = { [b]: new Date(Date.now() + 36e5).toISOString() };
    const w = mount(Probe);
    await vi.waitFor(() => expect(w.text()).toBe('1'));
  });
  it('inbox:bell обновляется при read', async () => {
    const a = uuidv7();
    await db.table('notifications').bulkPut([note(a, uuidv7())]);
    const w = mount(Probe);
    await vi.waitFor(() => expect(w.text()).toBe('1'));
    const { mutate } = await import('../../sync');
    await mutate('notification.read', { ids: [a] });
    await vi.waitFor(() => expect(w.text()).toBe('0'));
  });
});

describe('inbox:push', () => {
  const sub = {
    endpoint: 'https://push/e',
    toJSON: () => ({ endpoint: 'https://push/e', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current: typeof sub | null;
  const pm = {
    subscribe: vi.fn(async () => (current = sub)),
    getSubscription: vi.fn(async () => current),
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    current = null;
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager: pm }) },
      configurable: true,
    });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    fetchMock = vi.fn(
      async (_p: string, init?: RequestInit) =>
        new Response(init?.method === 'GET' ? JSON.stringify({ publicKey: 'AQAB' }) : null, {
          status: init?.method === 'GET' ? 200 : 204,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  const calls = (m: string) => fetchMock.mock.calls.filter((c) => c[1]?.method === m);
  const btn = (w: ReturnType<typeof mount>) => w.find('button');

  it('inbox:push подписка шлёт POST с ключами', async () => {
    const w = mount(PushToggle, { global: g });
    await flushPromises();
    await btn(w).trigger('click');
    await flushPromises();
    expect(pm.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(JSON.parse(calls('POST')[0][1].body)).toEqual({
      endpoint: 'https://push/e',
      keys: { p256dh: 'p', auth: 'a' },
    });
    expect(btn(w).text()).toBe(ru.inbox.pushOff);
  });
  it('inbox:push отписка шлёт DELETE', async () => {
    current = sub;
    const w = mount(PushToggle, { global: g });
    await flushPromises();
    await btn(w).trigger('click');
    await flushPromises();
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(JSON.parse(calls('DELETE')[0][1].body)).toEqual({ endpoint: 'https://push/e' });
  });
  it('inbox:push отказ в разрешении — сообщение', async () => {
    (Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied');
    const w = mount(PushToggle, { global: g });
    await flushPromises();
    await btn(w).trigger('click');
    await flushPromises();
    expect(w.find('[role=alert]').text()).toBe(ru.inbox.pushDenied);
    expect(calls('POST')).toHaveLength(0);
  });
  it('inbox:push на сервере нет VAPID (404) — сообщение про сервер', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'VAPID не настроен' }), { status: 404 }),
    );
    const w = mount(PushToggle, { global: g });
    await flushPromises();
    await btn(w).trigger('click');
    await flushPromises();
    expect(w.find('[role=alert]').text()).toBe(ru.inbox.pushUnconfigured);
    expect(pm.subscribe).not.toHaveBeenCalled();
  });
  it('inbox:push iOS не standalone — подсказка', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari',
    );
    expect(push.needsInstall()).toBe(true);
    const w = mount(PushToggle, { global: g });
    await nextTick();
    expect(w.find('[data-testid=push-ios]').exists()).toBe(true);
    expect(w.find('button').exists()).toBe(false);
  });
  it('polish: inbox:push iPadOS (MacIntel + тач) считается iOS', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh)');
    const pf = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const touch = vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(5);
    expect(push.needsInstall()).toBe(true);
    touch.mockReturnValue(0);
    expect(push.needsInstall()).toBe(false);
    [ua, pf, touch].forEach((x) => x.mockRestore());
  });
});

describe('inbox:snooze', () => {
  it('polish: inbox:snooze отложенное возвращается в срок без перезагрузки', async () => {
    vi.useFakeTimers();
    try {
      const { isSnoozed, snooze } = await import('../snooze');
      const c = computed(() => isSnoozed('n1'));
      expect(c.value).toBe(false);
      snooze('n1', new Date(Date.now() + 5000));
      expect(c.value).toBe(true);
      vi.advanceTimersByTime(6000);
      expect(c.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cl1a: inbox без задачи', () => {
  it('cl1a: уведомление chat_dm показывает body и ведёт на url', async () => {
    const id = uuidv7();
    await db.table('notifications').bulkPut([
      note(id, null as never, {
        spaceId: null,
        kind: 'chat_dm',
        url: '/m/chat/c/abc/def',
        body: 'Bob: созвонимся?',
      }),
    ]);
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.find('[data-testid=inbox-item]').exists()).toBe(true));
    const text = w.find('[data-testid=inbox-item]').text();
    expect(text).toContain('Личное сообщение от Bob');
    expect(text).toContain('Bob: созвонимся?');
    await w.find('[data-testid=inbox-item] button').trigger('click');
    await vi.waitFor(() =>
      expect(
        (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
      ).toBe('/m/chat/c/abc/def'),
    );
    expect((await db.table('notifications').get(id)).readAt).toBeTruthy();
  });

  it('cl1a: чужой url (//host) из уведомления не открывается', async () => {
    const id = uuidv7();
    await db.table('notifications').bulkPut([
      note(id, null as never, {
        spaceId: null,
        kind: 'chat_dm',
        url: '//evil.example',
        body: 'x',
      }),
    ]);
    const before = (router.current as { currentRoute: { value: { path: string } } }).currentRoute
      .value.path;
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.find('[data-testid=inbox-item]').exists()).toBe(true));
    await w.find('[data-testid=inbox-item] button').trigger('click');
    await flushPromises();
    expect(
      (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
    ).toBe(before);
  });
});

describe('PLNRAPP-629 статус задачи в «Комментарии мне»', () => {
  const sWork = uuidv7();
  const TaskStatusCell = async () => (await import('../TaskStatusCell.vue')).default;
  const seed = async () => {
    const tid = uuidv7();
    await db.table('statuses').bulkPut([
      {
        id: sTodo,
        spaceId: space,
        projectId: project,
        name: 'Открыта',
        category: 'todo',
        color: '#000',
        rank: 'a',
      },
      {
        id: sDone,
        spaceId: space,
        projectId: project,
        name: 'Готово',
        category: 'done',
        color: '#000',
        rank: 'b',
      },
      {
        id: sWork,
        spaceId: space,
        projectId: project,
        name: 'В работе',
        category: 'in_progress',
        color: '#000',
        rank: 'c',
      },
    ]);
    await db.table('spaces').put({ id: space, name: 'S', rank: 'a' });
    await db.table('projects').put({
      id: project,
      spaceId: space,
      key: 'PL',
      name: 'Planar',
      rank: 'a',
      membersMode: 'inherit',
    });
    // a full row: the status change goes through the task.update mutator (the row is validated)
    await db.table('tasks').put(
      task(tid, {
        number: 3,
        title: 'T3',
        parentId: null,
        description: null,
        priority: 0,
        rank: 'a',
        startDate: null,
        createdBy: bob,
        completedAt: null,
        fields: {},
        cycleId: null,
        archivedAt: null,
        archivedBy: null,
        commentsAssigned: 1,
        commentsResolved: 0,
        commentsOpenAssignees: [me],
        createdAt: ts(2),
        updatedAt: ts(2),
      }),
    );
    await db.table('comments').put({
      id: uuidv7(),
      spaceId: space,
      taskId: tid,
      body: null,
      authorId: bob,
      assigneeId: me,
      resolvedAt: null,
      createdAt: ts(1),
    });
    return tid;
  };
  const cell = async () => {
    const scope = effectScope();
    const list = scope.run(() => useAssignedComments(() => me))!;
    await vi.waitFor(() => expect(list.value?.length).toBe(1));
    const c = list.value![0]!;
    scope.stop();
    return mount(await TaskStatusCell(), {
      props: { task: c.task, status: c.status },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
  };

  it('элемент списка несёт задачу и её статус', async () => {
    const tid = await seed();
    const scope = effectScope();
    const list = scope.run(() => useAssignedComments(() => me))!;
    await vi.waitFor(() =>
      expect(list.value?.[0]).toMatchObject({
        key: 'PL-3',
        task: { id: tid, spaceId: space, projectId: project, statusId: sTodo },
        status: { id: sTodo, name: 'Открыта' },
      }),
    );
    scope.stop();
  });
  it('с правами: иконка с подсказкой, клик открывает меню, выбор меняет статус задачи', async () => {
    const tid = await seed();
    const w = await cell();
    await vi.waitFor(() => expect(w.find('button').exists()).toBe(true));
    expect(w.find('[data-testid=work-status]').attributes('title')).toBe('Открыта');
    expect(w.find('button svg[data-category=todo]').exists()).toBe(true);
    await w.find('button').trigger('click');
    await flushPromises();
    await vi.waitFor(() =>
      expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(3),
    );
    [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((o) => o.textContent?.includes('В работе'))!
      .click();
    await vi.waitFor(async () => expect((await db.table('tasks').get(tid))?.statusId).toBe(sWork));
    w.unmount();
  });
  it('гость: иконка неактивна, меню не открывается', async () => {
    useAuth().user.value = mkUser({ id: me, role: 'member' });
    await db.table('spaceMembers').put({ id: uuidv7(), spaceId: space, userId: me, role: 'guest' });
    await seed();
    const w = await cell();
    await flushPromises();
    const icon = w.find('[aria-disabled=true]');
    expect(icon.exists()).toBe(true);
    expect(icon.attributes('aria-label')).toBe('Открыта');
    expect(w.find('button').exists()).toBe(false);
    await icon.trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[role="option"]')).toBeNull();
    w.unmount();
  });
});
