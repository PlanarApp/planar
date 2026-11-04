import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick } from 'vue';
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
const MyScreen = (await import('../../screens/MyScreen.vue')).default;
const PushToggle = (await import('../PushToggle.vue')).default;
const { useUnread } = await import('../queries');
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
    w.unmount();
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

// MyScreen has icon buttons with tooltips: the app provides TooltipProvider at the root
const mountMy = () =>
  mount(defineComponent({ render: () => h(TooltipProvider, null, () => h(MyScreen)) }), {
    global: { plugins: [i18n, router.current] },
  });

describe('inbox:my', () => {
  const add = async (n: number, o: Record<string, unknown>, assignee = me) => {
    const id = uuidv7();
    await db.table('tasks').put(task(id, { number: n, title: `T${n}`, ...o }));
    await db
      .table('taskAssignees')
      .put({ id: uuidv7(), taskId: id, userId: assignee, spaceId: space });
  };
  it('inbox:my только мои', async () => {
    await add(1, {});
    await add(2, {}, bob);
    const w = mountMy();
    await vi.waitFor(() => expect(w.findAll('[data-testid=my-row]')).toHaveLength(1));
    expect(w.text()).toContain('T1');
  });
  it('inbox:my группы по сроку', async () => {
    await add(1, { dueDate: day(-1) });
    await add(2, { dueDate: day(0) });
    await add(3, { dueDate: day(30) });
    await add(4, {});
    const w = mountMy();
    await vi.waitFor(() => expect(w.findAll('[data-testid=my-row]')).toHaveLength(4));
    expect(w.findAll('section[data-group]').map((s) => s.attributes('data-group'))).toEqual([
      'overdue',
      'today',
      'later',
      'none',
    ]);
  });
  it('inbox:my завершённые скрыты', async () => {
    await add(1, { statusId: sDone });
    await add(2, {});
    const w = mountMy();
    await vi.waitFor(() => expect(w.findAll('[data-testid=my-row]')).toHaveLength(1));
    expect(w.text()).toContain('T2');
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
  const planned = (w: ReturnType<typeof show>) =>
    w.findAll('[data-testid=my-day-row]').map((r) => r.text().match(/T\d/)![0]);
  const click = async (el: { trigger: (e: string) => Promise<void> }) => {
    await el.trigger('click');
    await flushPromises();
  };

  it('добавление из списка, порядок, удаление', async () => {
    await add(1);
    await add(2);
    const w = show();
    await vi.waitFor(() => expect(w.findAll('[data-testid=my-day-add]')).toHaveLength(2));
    expect(w.find('[data-testid=my-day-row]').exists()).toBe(false);
    // add T2, then T1: in the order of adding; a planned task loses its «+»
    const plus = (n: string) =>
      w
        .findAll('[data-testid=my-row]')
        .find((r) => r.text().includes(n))!
        .element.parentElement!.querySelector<HTMLElement>('[data-testid=my-day-add]');
    plus('T2')!.click();
    await vi.waitFor(() => expect(planned(w)).toEqual(['T2']));
    plus('T1')!.click();
    await vi.waitFor(() => expect(planned(w)).toEqual(['T2', 'T1']));
    expect(w.findAll('[data-testid=my-day-add]')).toHaveLength(0);
    // T1 up
    await click(w.findAll('[data-testid=my-day-row]')[1]!.find('button[aria-label="Выше"]'));
    await vi.waitFor(() => expect(planned(w)).toEqual(['T1', 'T2']));
    await click(w.findAll('[data-testid=my-day-remove]')[0]!);
    await vi.waitFor(() => expect(planned(w)).toEqual(['T2']));
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
