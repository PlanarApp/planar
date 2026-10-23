import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { domainMutators, uuidv7 } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { useAuth } from '../../auth/useAuth';
import { mkUser } from '../../auth/__tests__/helpers';

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
  snoozed.value = {};
  useAuth().user.value = mkUser({ id: me });
  await startSync({ userId: me, fetch: (() => Promise.reject(new TypeError('offline'))) as never });
  await db.table('users').bulkPut([{ id: bob, name: 'Bob' }]);
  await db.table('projects').bulkPut([{ id: project, key: 'PL', name: 'Planar' }]);
  await db.table('statuses').bulkPut([
    { id: sTodo, category: 'todo', color: '#000' },
    { id: sDone, category: 'done', color: '#000' },
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
  it('inbox:list клик читает и открывает задачу', async () => {
    await seed();
    const id = uuidv7();
    await db.table('notifications').bulkPut([note(id, t1)]);
    const w = mount(InboxScreen, { global: g });
    await vi.waitFor(() => expect(w.find('[data-testid=inbox-item]').exists()).toBe(true));
    await w.find('[data-testid=inbox-item] button').trigger('click');
    await vi.waitFor(async () =>
      expect((await db.table('notifications').get(id)).readAt).toBeTruthy(),
    );
    await vi.waitFor(() =>
      expect(
        (router.current as { currentRoute: { value: { path: string } } }).currentRoute.value.path,
      ).toBe('/t/PL-1'),
    );
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
    const w = mount(MyScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=my-row]')).toHaveLength(1));
    expect(w.text()).toContain('T1');
  });
  it('inbox:my группы по сроку', async () => {
    await add(1, { dueDate: day(-1) });
    await add(2, { dueDate: day(0) });
    await add(3, { dueDate: day(30) });
    await add(4, {});
    const w = mount(MyScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=my-row]')).toHaveLength(4));
    expect(w.findAll('section').map((s) => s.attributes('data-group'))).toEqual([
      'overdue',
      'today',
      'later',
      'none',
    ]);
  });
  it('inbox:my завершённые скрыты', async () => {
    await add(1, { statusId: sDone });
    await add(2, {});
    const w = mount(MyScreen, { global: g });
    await vi.waitFor(() => expect(w.findAll('[data-testid=my-row]')).toHaveLength(1));
    expect(w.text()).toContain('T2');
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
