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
import { VueDraggable } from 'vue-draggable-plus';
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
const MyDay = (await import('../MyDay.vue')).default;
const DayOptions = (await import('../DayOptions.vue')).default;
const { useTaskFilter } = await import('../../views/saved/useFilter');
const PushToggle = (await import('../PushToggle.vue')).default;
const { useUnread, useAssignedComments } = await import('../queries');
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

// the list under the planer is the regular view with Me Mode 'day' (PLNRAPP-137; the selection — PLNRAPP-81)
describe('inbox:my', () => {
  it('Me Mode day: мои открытые — просрочено, сегодня (по сроку и по началу), без срока; поздние, чужие и завершённые скрыты', async () => {
    const statuses = await db.table('statuses').toArray();
    const scope = effectScope();
    const pred = scope.run(() => useTaskFilter(null, statuses, 'day'))!;
    const v = (o: Record<string, unknown>, assignee = me) =>
      ({ ...task(uuidv7(), o), assigneeIds: [assignee], labelIds: [] }) as never;
    expect(pred.value(v({ dueDate: day(-1) }))).toBe(true);
    expect(pred.value(v({ dueDate: day(0) }))).toBe(true);
    expect(pred.value(v({}))).toBe(true);
    expect(pred.value(v({ dueDate: day(10), startDate: day(-2) }))).toBe(true);
    expect(pred.value(v({ dueDate: day(30) }))).toBe(false);
    expect(pred.value(v({}, bob))).toBe(false);
    expect(pred.value(v({ statusId: sDone }))).toBe(false);
    scope.stop();
  });
  it('PLNRAPP-140 задача с моим открытым пунктом чек-листа — моя: «Назначенные», «Мой день», список «Комментарии для меня»', async () => {
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
    const [assigned, today, list] = scope.run(() => [
      useTaskFilter(null, statuses, 'assigned'),
      useTaskFilter(null, statuses, 'day'),
      useAssignedComments(() => me),
    ])!;
    // the task itself is not assigned to me
    const t7 = { ...task(tid, {}), assigneeIds: [bob], labelIds: [] } as never;
    await vi.waitFor(() => expect(assigned.value(t7)).toBe(true));
    expect(today.value(t7)).toBe(true);
    await vi.waitFor(() =>
      expect(list.value?.map((x) => [x.kind, x.key])).toEqual([['check', expect.any(String)]]),
    );
    // checked — no longer mine
    await db.table('checklistItems').put({ ...item, done: true });
    await vi.waitFor(() => expect(assigned.value(t7)).toBe(false));
    scope.stop();
  });
});

describe('PLANARAPP-10 мой день', () => {
  const add = async (n: number, o: Record<string, unknown> = {}) => {
    const id = uuidv7();
    await db.table('tasks').put(task(id, { number: n, title: `T${n}`, ...o }));
    await db.table('taskAssignees').put({ id: uuidv7(), taskId: id, userId: me, spaceId: space });
    return id;
  };
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

  it('добавление из меню «Срок», порядок, удаление', async () => {
    const t1 = await add(1);
    const t2 = await add(2);
    const w = show();
    await vi.waitFor(() => expect(w.find('[data-testid=my-day]').exists()).toBe(true));
    expect(w.find('[data-testid=my-day-row]').exists()).toBe(false);
    // PLNRAPP-137: «My day» choices of a task's «Due date» menu; T2, then T1 — in the order of adding
    const options = (taskId: string) =>
      mount(DayOptions, { props: { taskId }, global: { plugins: [i18n] } });
    const pick = async (taskId: string, id: string) => {
      const o = options(taskId);
      await vi.waitFor(() => expect(o.find(`[data-testid=${id}]`).exists()).toBe(true));
      await o.get(`[data-testid=${id}]`).trigger('click');
      await flushPromises();
      return o;
    };
    await pick(t2, 'day-options-today');
    await vi.waitFor(() => expect(planned(w)).toEqual(['T2']));
    const o1 = await pick(t1, 'day-options-today');
    await vi.waitFor(() => expect(planned(w)).toEqual(['T2', 'T1']));
    // planned for today: «Add» is gone, «Remove» is offered
    await vi.waitFor(() => expect(o1.find('[data-testid=day-options-remove]').exists()).toBe(true));
    expect(o1.find('[data-testid=day-options-today]').exists()).toBe(false);
    // T1 dragged to the top (jsdom has no real drag: the drop event of VueDraggable)
    const dnd = w.findComponent(VueDraggable);
    dnd.vm.$emit('update', { data: (dnd.props('modelValue') as unknown[])[1], newIndex: 0 });
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1', 'T2']));
    await act(w, '[data-block=today]', 'my-day-remove');
    await vi.waitFor(() => expect(planned(w)).toEqual(['T2']));
    // to tomorrow: leaves today for the «Tomorrow» block, the plan row gets tomorrow's date
    await act(w, '[data-block=today]', 'my-day-tomorrow');
    await vi.waitFor(() => expect(planned(w)).toEqual([]));
    expect(planned(w, 'tomorrow')).toEqual(['T2']);
    expect((await db.table('dayPlans').toArray()).map((p) => p.date)).toEqual([day(1)]);
  });

  it('PLANARAPP-58: планер — Сегодня, Завтра, Позже; переносы кнопками и перетаскиванием', async () => {
    const ids = [await add(1), await add(2), await add(3), await add(4, { statusId: sDone })];
    const dates = [day(0), day(1), day(5), day(0)];
    await db.table('dayPlans').bulkPut(
      ids.map((taskId, i) => ({
        id: uuidv7(),
        userId: me,
        taskId,
        date: dates[i],
        rank: `a${i}`,
        createdAt: ts(1),
        updatedAt: ts(1),
      })),
    );
    const w = show();
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1', 'T4']));
    expect(planned(w, 'tomorrow')).toEqual(['T2']);
    expect(planned(w, 'later')).toEqual(['T3']);
    // planned on any day — no «+» in the list
    expect(w.findAll('[data-testid=my-day-add]')).toHaveLength(0);
    // later → today: to the end of today
    await act(w, '[data-block=later]', 'my-day-today');
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1', 'T4', 'T3']));
    // unfinished of today → tomorrow; the done T4 stays
    await click(w.find('[data-testid=my-day-postpone]'));
    await vi.waitFor(() => expect(planned(w)).toEqual(['T4']));
    expect(planned(w, 'tomorrow')).toEqual(['T2', 'T1', 'T3']);
    // dropped on «Later» (jsdom: the add event of VueDraggable) — in a week
    const later = w.findAllComponents(VueDraggable)[2]!;
    const t2 = (w.findAllComponents(VueDraggable)[1]!.props('modelValue') as unknown[])[0];
    later.vm.$emit('add', { data: t2, newIndex: 0 });
    await vi.waitFor(() => expect(planned(w, 'later')).toEqual(['T2']));
    const plan = await db.table('dayPlans').get((t2 as { plan: { id: string } }).plan.id);
    expect(plan.date).toBe(day(7));
  });

  it('незавершённое с прошлых дней переносится на сегодня; завершённое — нет', async () => {
    const open = await add(1);
    const done = await add(2, { statusId: sDone });
    const plan = (taskId: string, date: string) => ({
      id: uuidv7(),
      userId: me,
      taskId,
      date,
      rank: 'a0',
      createdAt: ts(30),
      updatedAt: ts(30),
    });
    await db.table('dayPlans').bulkPut([plan(open, day(-1)), plan(done, day(-1))]);
    const w = show();
    await vi.waitFor(() => expect(w.find('[data-testid=my-day-carry]').exists()).toBe(true));
    expect(w.find('[data-testid=my-day-carry]').text()).toContain('1');
    await click(w.find('[data-testid=my-day-carry] button'));
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1']));
    expect(w.find('[data-testid=my-day-carry]').exists()).toBe(false);
  });

  it('PLANARAPP-52: «Мой день» группы — план только её проектов', async () => {
    const other = uuidv7();
    const t1 = await add(1);
    const t2 = await add(2, { projectId: other });
    await db.table('dayPlans').bulkPut(
      [t1, t2].map((taskId, i) => ({
        id: uuidv7(),
        userId: me,
        taskId,
        date: day(0),
        rank: `a${i}`,
        createdAt: ts(1),
        updatedAt: ts(1),
      })),
    );
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
