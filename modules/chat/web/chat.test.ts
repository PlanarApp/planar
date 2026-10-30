import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount as vmount } from '@vue/test-utils';
import { db, Editor, i18n, newId, resetBreakpoint } from '@planar/web/modules';
import { web } from './index';
import { shared } from '../shared';
import { mergeFeed, taskRefs, type Channel, type Message } from './model';
import { useFeed } from './feed';
import { useChatData } from './data';
import { useTyping } from './typing';
import Section from './Section.vue';
import ChannelView from './ChannelView.vue';
import ThreadPanel from './ThreadPanel.vue';
import Composer from './Composer.vue';
import MessageItem from './MessageItem.vue';
import ChatPage from './ChatPage.vue';

// Editor из SDK берёт строки у i18n приложения
const mounted: { unmount(): void }[] = [];
const mount = ((c: never, o: object = {}) => {
  // Tooltip требует TooltipProvider (в приложении он в App.vue) — в тестах пропускаем обёртку
  const w = vmount(c, {
    ...o,
    global: { plugins: [i18n], stubs: { Tooltip: { template: '<slot />' } } },
  });
  mounted.push(w);
  return w;
}) as unknown as typeof vmount;

const ME = newId();
const ANNA = newId();
const BOB = newId();
const SPACE = newId();
const NOW = '2026-10-23T10:00:00.000Z';

const h_ = vi.hoisted(() => ({
  mutate: vi.fn(),
  api: vi.fn(),
  sendTyping: vi.fn(),
  openTask: vi.fn(),
  typingCb: undefined as undefined | ((e: { entity: string; id: string; userId: string }) => void),
  errCb: undefined as undefined | ((e: { name: string; message: string }) => void),
  push: vi.fn(),
  upload: vi.fn(),
  route: { params: {} as Record<string, string> },
}));
vi.mock('@planar/web/modules', async (orig) => {
  const m = await orig<typeof import('@planar/web/modules')>();
  const { ref } = await import('vue');
  return {
    ...m,
    mutate: h_.mutate,
    api: h_.api,
    sendTyping: h_.sendTyping,
    openTask: h_.openTask,
    uploadFile: h_.upload,
    onTyping: (cb: never) => ((h_.typingCb = cb), () => (h_.typingCb = undefined)),
    onMutationError: (cb: never) => ((h_.errCb = cb), () => (h_.errCb = undefined)),
    useSession: () => ref({ id: (globalThis as Record<string, unknown>).__ME }),
  };
});
(globalThis as unknown as { __ME: string }).__ME = ME;
vi.mock('vue-router', async (orig) => ({
  ...(await orig<object>()),
  useRouter: () => ({ push: h_.push, replace: h_.push }),
  useRoute: () => h_.route,
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}));

const chan = (id: string, o: Partial<Channel> = {}): Channel => ({
  id,
  spaceId: SPACE,
  projectId: null,
  kind: 'channel',
  name: id,
  topic: null,
  createdBy: ME,
  lastSeq: 0,
  lastMessageAt: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});
const msg = (seq: number | null, o: Partial<Message> = {}): Message => ({
  id: newId(),
  spaceId: SPACE,
  channelId: CH,
  parentId: null,
  seq,
  authorId: ANNA,
  body: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `m${seq}` }] }],
  },
  mentions: [],
  attachments: [],
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deletedAt: null,
  createdAt: new Date(Date.parse(NOW) + (seq ?? 0) * 1000).toISOString(),
  updatedAt: NOW,
  ...o,
});
const read = (channelId: string, lastReadSeq: number, muted = false) => ({
  id: newId(),
  userId: ME,
  channelId,
  lastReadSeq,
  muted,
  updatedAt: NOW,
});
const CH = newId();
const fresh = async () => {
  for (const t of [
    'chatChannels',
    'chatMembers',
    'chatMessages',
    'chatReactions',
    'chatReads',
    'users',
    'spaces',
    'spaceMembers',
    'projects',
    'tasks',
    'statuses',
  ])
    await db.table(t).clear();
  await db.table('users').bulkPut([
    { id: ME, name: 'Я' },
    { id: ANNA, name: 'Анна' },
    { id: BOB, name: 'Борис' },
  ]);
  await db.table('spaces').put({ id: SPACE, name: 'Alpha', rank: 'a0' });
  await db.table('spaceMembers').bulkPut([
    { id: newId(), spaceId: SPACE, userId: ME, role: 'member' },
    { id: newId(), spaceId: SPACE, userId: ANNA, role: 'member' },
  ]);
};
const texts = (w: { findAll: (s: string) => { text: () => string }[] }, sel: string) =>
  w.findAll(sel).map((e) => e.text());

beforeEach(async () => {
  localStorage.clear();
  i18n.global.locale.value = 'ru';
  h_.mutate.mockReset().mockResolvedValue(undefined);
  h_.api.mockReset().mockResolvedValue({ messages: [], reactions: [] });
  h_.sendTyping.mockReset();
  h_.push.mockReset();
  h_.route.params = {};
  await fresh();
});
afterEach(() => {
  vi.useRealTimers();
  mounted.splice(0).forEach((w) => w.unmount());
});

// размеры в happy-dom нулевые: окно 600 px, строка 72 px
const rect = (w: number, hgt: number) => ({
  width: w,
  height: hgt,
  top: 0,
  left: 0,
  right: w,
  bottom: hgt,
  x: 0,
  y: 0,
  toJSON() {},
});
const proto = HTMLElement.prototype as unknown as { getBoundingClientRect(): unknown };
const origRect = proto.getBoundingClientRect;
function stubSizes() {
  // виртуализатор читает clientHeight окна прокрутки
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  });
  // строки замеряются по offsetHeight
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.index !== undefined ? 72 : 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  });
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.dataset.index !== undefined ? rect(800, 72) : rect(800, 600);
  };
}
afterEach(() => {
  proto.getBoundingClientRect = origRect;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
});

describe('chat web: манифест', () => {
  it('маршруты, кнопка в верхней панели', () => {
    expect(web.id).toBe('chat');
    expect(web.routes!.map((r) => r.path)).toEqual([
      '/m/chat/',
      '/m/chat/c/:channelId/:messageId?',
      '/m/chat/c/:channelId/t/:rootId',
    ]);
    expect(web.groupTabs![0]).toMatchObject({
      id: 'channels',
      tab: 'chats',
      component: expect.any(Function),
    });
    expect(web.topbar!.map((x) => x.id)).toEqual(['chats']);
  });
});

describe('счётчик чатов', () => {
  it('считает только непрочитанные упоминания и 1:1 по каналу; прочее — лишь непрочитанное', async () => {
    const a = newId();
    await db.table('chatChannels').put(chan(a, { lastSeq: 5 }));
    const n = (kind: string, readAt: string | null, ch = a) => ({
      id: newId(),
      userId: ME,
      kind,
      url: `/m/chat/c/${ch}/${newId()}`,
      readAt,
    });
    await db
      .table('notifications')
      .bulkPut([
        n('chat_mention', null),
        n('chat_dm', NOW),
        n('chat_reply', null),
        n('assigned', null),
      ]);
    const w = mount(
      defineComponent({
        setup: () => {
          const x = useChatData();
          return () =>
            h(
              'p',
              x.ready.value
                ? `${x.total.value}/${x.attentionOf(chan(a))}/${x.unreadOf(chan(a, { lastSeq: 5 }))}`
                : '',
            );
        },
      }),
    );
    await vi.waitFor(() => expect(w.text()).toBe('1/1/5'));
  });
});

describe('секция боковой панели', () => {
  it('каналы пространства по имени без архивных, счётчик = lastSeq − lastReadSeq, muted без счётчика', async () => {
    await db
      .table('chatChannels')
      .bulkPut([
        chan('b-two', { name: 'beta', lastSeq: 5 }),
        chan('a-one', { name: 'alpha', lastSeq: 3 }),
        chan('old', { name: 'old', archivedAt: NOW }),
        chan('quiet', { name: 'zzz', lastSeq: 9 }),
      ]);
    await db.table('chatReads').bulkPut([read('b-two', 2), read('quiet', 0, true)]);
    const w = mount(Section);
    await vi.waitFor(() => expect(w.findAll('[data-testid=chat-channel]').length).toBe(3));
    const rows = texts(w, '[data-testid=chat-channel]');
    expect(rows.map((r) => r.replace(/\d+$/, '').trim())).toEqual(['alpha', 'beta', 'zzz']);
    expect(rows[0]).toMatch(/3$/); // нет строки chatReads — 0
    expect(rows[1]).toMatch(/3$/); // 5 − 2
    expect(rows[2]).toBe('zzz'); // muted
  });

  it('одно пространство — без заголовка с его именем; заголовок «Чат» сворачивает секцию', async () => {
    await db.table('chatChannels').put(chan('a-one', { name: 'alpha', lastSeq: 1 }));
    const w = mount(Section);
    await vi.waitFor(() => expect(w.findAll('[data-testid=chat-channel]').length).toBe(1));
    expect(w.text()).not.toContain('Alpha');
    await w.find('h2 button').trigger('click');
    expect(w.findAll('[data-testid=chat-channel]').length).toBe(0);
  });

  it('без каналов: «Нет каналов» и одна кнопка создать, без имён пространств', async () => {
    const w = mount(Section);
    await vi.waitFor(() => expect(w.find('[data-testid=chat-add-channel]').exists()).toBe(true));
    expect(w.text()).toContain('Нет каналов');
    expect(w.findAll('[data-testid=chat-add-channel]').length).toBe(1);
  });

  it('диалоги по lastMessageAt, имя — участники кроме меня', async () => {
    const d1 = chan('d1', {
      spaceId: null,
      kind: 'dm',
      name: null,
      lastMessageAt: '2026-10-23T09:00:00.000Z',
    });
    const d2 = chan('d2', {
      spaceId: null,
      kind: 'dm',
      name: null,
      lastMessageAt: '2026-10-23T11:00:00.000Z',
    });
    await db.table('chatChannels').bulkPut([d1, d2]);
    const mem = (channelId: string, userId: string) => ({
      id: newId(),
      channelId,
      userId,
      addedBy: ME,
      createdAt: NOW,
    });
    await db
      .table('chatMembers')
      .bulkPut([mem('d1', ME), mem('d1', ANNA), mem('d2', ME), mem('d2', ANNA), mem('d2', BOB)]);
    const w = mount(Section);
    await vi.waitFor(() => expect(w.findAll('[data-testid=chat-dm]').length).toBe(2));
    expect(texts(w, '[data-testid=chat-dm]')).toEqual(['Анна, Борис', 'Анна']);
  });

  it('диалог с тем же составом открывает существующий, иначе chat.dm.create', async () => {
    const d1 = chan('d1', { spaceId: null, kind: 'dm', name: null });
    await db.table('chatChannels').put(d1);
    await db.table('chatMembers').bulkPut(
      [ME, ANNA].map((userId) => ({
        id: newId(),
        channelId: 'd1',
        userId,
        addedBy: ME,
        createdAt: NOW,
      })),
    );
    const w = mount(Section);
    await vi.waitFor(() => expect(w.find('[data-testid=chat-dm]').exists()).toBe(true));
    await w.find('[data-testid=chat-add-dm]').trigger('click');
    await w.find(`[data-testid=chat-pick-${ANNA}]`).setValue(true);
    await w.find('form button[type=submit]').trigger('submit');
    await flushPromises();
    expect(h_.mutate).not.toHaveBeenCalled();
    expect(h_.push).toHaveBeenCalledWith('/m/chat/c/d1');

    await w.find('[data-testid=chat-add-dm]').trigger('click'); // панель выбора закрылась после перехода
    await w.find(`[data-testid=chat-pick-${BOB}]`).setValue(true);
    await w.find('form').trigger('submit');
    await flushPromises();
    const [name, args] = h_.mutate.mock.calls[0]!;
    expect(name).toBe('chat.dm.create');
    expect(args.members.map((m: { userId: string }) => m.userId)).toEqual([ME, BOB]);
  });

  it('+ канал вызывает chat.channel.create', async () => {
    await db.table('chatChannels').put(chan('c1'));
    const w = mount(Section);
    await vi.waitFor(() => expect(w.find('[data-testid=chat-add-channel]').exists()).toBe(true));
    await w.find('[data-testid=chat-add-channel]').trigger('click');
    await w.find('form input').setValue('  новости ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(h_.mutate).toHaveBeenCalledWith(
      'chat.channel.create',
      expect.objectContaining({ spaceId: SPACE, name: 'новости' }),
    );
  });
});

describe('лента', () => {
  it('mergeFeed: без дублей, строка реплики новее REST, порядок по seq, неподтверждённые в конце', () => {
    const a = msg(1);
    const b = msg(2);
    const bNew = { ...b, editedAt: NOW };
    const pending = msg(null);
    const c = msg(3);
    const out = mergeFeed([b, a], [pending, bNew, c]);
    expect(out.map((m) => m.id)).toEqual([a.id, b.id, c.id, pending.id]);
    expect(out[1]!.editedAt).toBe(NOW);
  });

  it('первая загрузка — последние сообщения, подгрузка — before = минимальный seq', async () => {
    const page = (from: number, to: number) => ({
      messages: Array.from({ length: to - from + 1 }, (_, i) => msg(from + i)),
      reactions: [],
    });
    h_.api.mockResolvedValueOnce(page(51, 100)).mockResolvedValueOnce(page(1, 50));
    let feed!: ReturnType<typeof useFeed>;
    mount(defineComponent({ setup: () => ((feed = useFeed(CH)), () => h('div')) }));
    await feed.loadOlder();
    await feed.loadOlder();
    expect(h_.api.mock.calls[0]![1]).toBe(`/api/chat/channels/${CH}/messages?limit=50`);
    expect(h_.api.mock.calls[1]![1]).toBe(`/api/chat/channels/${CH}/messages?limit=50&before=51`);
    expect(feed.messages.value).toHaveLength(100);
    await feed.loadOlder(); // дошли до seq 1 — запросов больше нет
    expect(h_.api).toHaveBeenCalledTimes(2);
  });

  const props = (extra = {}) => ({
    channel: chan(CH),
    users: new Map([
      [ME, { id: ME, name: 'Я' }],
      [ANNA, { id: ANNA, name: 'Анна' }],
    ]),
    me: ME,
    readSeq: 0,
    members: [],
    ...extra,
  });

  it('messageId: догружает историю до сообщения и подсвечивает; нет — «не найдено»', async () => {
    const target = msg(10);
    const page = (from: number, to: number) => ({
      messages: Array.from({ length: to - from + 1 }, (_, i) =>
        from + i === 10 ? target : msg(from + i),
      ),
      reactions: [],
    });
    stubSizes();
    h_.api.mockResolvedValueOnce(page(51, 100)).mockResolvedValueOnce(page(1, 50));
    const w = mount(ChannelView, {
      props: props({ channel: chan(CH, { lastSeq: 100 }), messageId: target.id }),
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(w.find('[data-highlight]').exists()).toBe(true));
    expect(h_.api).toHaveBeenCalledTimes(2);
    expect(w.find('[data-highlight]').attributes('data-testid')).toBe(`chat-msg-${target.id}`);
    w.unmount();

    h_.api.mockReset();
    h_.api.mockResolvedValue({ messages: [], reactions: [] });
    const w2 = mount(ChannelView, {
      props: props({ messageId: 'нет-такого' }),
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(w2.find('[data-testid=chat-not-found]').exists()).toBe(true));
  });

  it('ensure: сообщение из реплики находится без догрузки; ≤ 20 страниц', async () => {
    const m = msg(500);
    await db.table('chatMessages').put(m);
    h_.api.mockReset();
    h_.api.mockImplementation(async () => ({
      messages: Array.from({ length: 50 }, () => msg(900)),
      reactions: [],
    }));
    let feed!: ReturnType<typeof useFeed>;
    mount(defineComponent({ setup: () => ((feed = useFeed(CH)), () => h('div')) }));
    await vi.waitFor(() => expect(feed.ready.value).toBe(true));
    expect(await feed.ensure(m.id)).toBe(true);
    expect(h_.api).not.toHaveBeenCalled();
    expect(await feed.ensure('нет')).toBe(false);
    expect(h_.api.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('REST-страница и реплика сливаются без дублей', async () => {
    const shared = msg(2);
    h_.api.mockResolvedValue({ messages: [msg(1), shared], reactions: [] });
    await db.table('chatMessages').bulkPut([{ ...shared, editedAt: NOW }, msg(3)]);
    stubSizes();
    const w = mount(ChannelView, { props: props() });
    await vi.waitFor(() => expect(w.findAll('article').length).toBe(3));
    expect(texts(w, 'article').map((t) => /m\d/.exec(t)![0])).toEqual(['m1', 'm2', 'm3']);
    expect(w.text()).toContain('изменено');
  });

  it('10 000 сообщений: в DOM не больше ~60 строк', async () => {
    stubSizes();
    // история приходит страницами REST и живёт в памяти (fake-indexeddb на 10 000 строк квадратичен)
    h_.api.mockResolvedValueOnce({
      messages: Array.from({ length: 10_000 }, (_, i) => msg(i + 1)),
      reactions: [],
    });
    const w = mount(ChannelView, {
      props: props({ channel: chan(CH, { lastSeq: 10_000 }) }),
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(w.findAll('article').length).toBeGreaterThan(0), {
      timeout: 20_000,
    });
    await flushPromises();
    expect(w.findAll('article').length).toBeLessThanOrEqual(60);
  }, 30_000);

  it('отправка появляется в ленте сразу после mutate (≤ 50 мс в happy-dom)', async () => {
    stubSizes();
    h_.mutate.mockImplementation(async (name: string, a: { id: string; body: unknown }) => {
      if (name === 'chat.message.send')
        await db
          .table('chatMessages')
          .put(msg(1, { id: a.id, authorId: ME, body: a.body as never }));
    });
    const w = mount(ChannelView, { props: props(), attachTo: document.body });
    await flushPromises();
    const ed = w.findComponent(Editor);
    ed.vm.$emit('update:modelValue', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'привет-быстро' }] }],
    });
    await nextTick();
    const t0 = performance.now();
    const shown = new Promise<number>((res) => {
      const done = () => w.text().includes('привет-быстро') && res(performance.now() - t0);
      new MutationObserver(done).observe(w.element, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    await w.find('button[aria-label=Отправить]').trigger('click');
    const dt = await shown;
    expect(h_.mutate).toHaveBeenCalledWith(
      'chat.message.send',
      expect.objectContaining({ channelId: CH, readId: expect.any(String) }),
    );
    expect(dt).toBeLessThanOrEqual(50);
  });

  it('chat.read уходит с максимальным видимым seq и один раз', async () => {
    stubSizes();
    await db.table('chatMessages').bulkPut([1, 2, 3, 4, 5].map((s) => msg(s)));
    mount(ChannelView, {
      props: props({ channel: chan(CH, { lastSeq: 5 }) }),
      attachTo: document.body,
    });
    await vi.waitFor(() =>
      expect(h_.mutate).toHaveBeenCalledWith(
        'chat.read',
        expect.objectContaining({ channelId: CH, lastReadSeq: 5 }),
      ),
    );
    await flushPromises();
    expect(h_.mutate.mock.calls.filter(([n]) => n === 'chat.read')).toHaveLength(1);
  });

  it('уже прочитанное не отправляется', async () => {
    stubSizes();
    await db.table('chatMessages').bulkPut([1, 2].map((s) => msg(s)));
    const w = mount(ChannelView, {
      props: props({ readSeq: 2, channel: chan(CH, { lastSeq: 2 }) }),
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(w.findAll('article').length).toBe(2));
    await flushPromises();
    expect(h_.mutate).not.toHaveBeenCalled();
  });
});

describe('тред', () => {
  it('показывает корень и ответы (REST + реплика)', async () => {
    const root = msg(1, { replyCount: 2 });
    const r1 = msg(null, {
      parentId: root.id,
      createdAt: '2026-10-23T10:05:00.000Z',
      body: msg(0).body,
    });
    const r2 = msg(null, {
      parentId: root.id,
      createdAt: '2026-10-23T10:06:00.000Z',
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ответ-локальный' }] }],
      },
    });
    h_.api.mockResolvedValue({ root, replies: [r1], reactions: [] });
    await db.table('chatMessages').bulkPut([root, r2]);
    const w = mount(ThreadPanel, {
      props: { channelId: CH, rootId: root.id, users: new Map(), me: ME, members: [] },
    });
    await vi.waitFor(() => expect(w.findAll('article').length).toBe(3));
    expect(h_.api).toHaveBeenCalledWith('GET', `/api/chat/messages/${root.id}/thread`);
    expect(w.findAll('article')[2]!.text()).toContain('ответ-локальный');
  });
});

describe('«печатает…»', () => {
  it('показывается и гаснет через 5 с', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let who!: ReturnType<typeof useTyping>;
    mount(defineComponent({ setup: () => ((who = useTyping(CH, () => ME)), () => h('div')) }));
    h_.typingCb!({ entity: 'chatChannels', id: CH, userId: ANNA });
    h_.typingCb!({ entity: 'chatChannels', id: CH, userId: ME }); // себя не показываем
    h_.typingCb!({ entity: 'chatChannels', id: newId(), userId: BOB }); // чужой канал
    expect(who.value).toEqual([ANNA]);
    vi.advanceTimersByTime(4900);
    expect(who.value).toEqual([ANNA]);
    vi.advanceTimersByTime(200);
    expect(who.value).toEqual([]);
  });

  it('ввод шлёт sendTyping не чаще раза в 2 с', async () => {
    const w = mount(Composer, { props: { channelId: CH, members: [] } });
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
    };
    const ed = w.findComponent(Editor);
    ed.vm.$emit('update:modelValue', doc);
    ed.vm.$emit('update:modelValue', doc);
    expect(h_.sendTyping).toHaveBeenCalledTimes(1);
    expect(h_.sendTyping).toHaveBeenCalledWith('chatChannels', CH);
  });
});

describe('сообщение', () => {
  const base = {
    reactions: [],
    users: new Map([[ANNA, { id: ANNA, name: 'Анна' }]]),
    me: ME,
    members: [],
  };
  const withText = (text: string) =>
    msg(1, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    });

  it('PLN-123 раскрывается карточкой с заголовком и статусом, openTask по клику', async () => {
    const PRJ = newId();
    const ST = newId();
    const TASK = newId();
    await db
      .table('projects')
      .put({ id: PRJ, spaceId: SPACE, name: 'P', key: 'PLN', rank: 'a0', archivedAt: null });
    await db.table('statuses').put({ id: ST, spaceId: SPACE, name: 'В работе', rank: 'a0' });
    await db.table('tasks').put({
      id: TASK,
      spaceId: SPACE,
      projectId: PRJ,
      number: 123,
      statusId: ST,
      title: 'Починить вход',
    });
    const w = mount(MessageItem, { props: { ...base, message: withText('см. PLN-123 и ZZZ-9') } });
    await vi.waitFor(() => expect(w.findAll('[data-testid=chat-task-card]').length).toBe(1));
    const card = w.find('[data-testid=chat-task-card]');
    expect(card.text()).toContain('Починить вход');
    await vi.waitFor(() => expect(card.text()).toContain('В работе'));
    await card.trigger('click');
    expect(h_.openTask).toHaveBeenCalledWith('PLN-123');
    expect(w.text()).toContain('ZZZ-9'); // нет задачи — обычный текст
  });

  it('taskRefs находит ключи без повторов', () => {
    expect(taskRefs(withText('PLN-1, PLN-1 и AB-22; utf-8').body)).toEqual(['PLN-1', 'AB-22']);
  });

  it('упоминание подсвечено, небезопасная ссылка не становится <a>', () => {
    const body = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: ME, label: 'Я' } },
            {
              type: 'text',
              text: ' x',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            {
              type: 'text',
              text: 'y',
              marks: [{ type: 'link', attrs: { href: 'https://e.org' } }],
            },
          ],
        },
      ],
    };
    const w = mount(MessageItem, { props: { ...base, message: msg(1, { body }) } });
    expect(w.find('.mention').text()).toBe('@Я');
    expect(w.findAll('.chat-body a').map((a) => a.attributes('href'))).toEqual(['https://e.org']);
  });

  it('править и удалять можно только своё; реакция и ответ', async () => {
    const other = mount(MessageItem, { props: { ...base, message: msg(1) } });
    await other.trigger('pointerenter');
    expect(other.find('button[aria-label=Реакция]').exists()).toBe(true);
    expect(other.find('button[aria-label=Изменить]').exists()).toBe(false);
    const own = mount(MessageItem, {
      props: { ...base, message: msg(2, { authorId: ME, replyCount: 3 }) },
    });
    await own.trigger('pointerenter');
    await own.find('button[aria-label=Удалить]').trigger('click');
    expect(h_.mutate).not.toHaveBeenCalledWith('chat.message.delete', expect.anything());
    // подтверждение — в диалоге (портал в body)
    const ok = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Удалить',
    );
    ok!.click();
    await vi.waitFor(() =>
      expect(h_.mutate).toHaveBeenCalledWith('chat.message.delete', {
        id: own.props('message').id,
      }),
    );
    expect(own.find('[data-testid=chat-replies]').attributes('href')).toMatch(/\/t\//);
    await own.find('button[aria-label=Реакция]').trigger('click');
    await own
      .findAll('button')
      .find((b) => b.text() === '👍')!
      .trigger('click');
    await vi.waitFor(() =>
      expect(h_.mutate).toHaveBeenCalledWith(
        'chat.reaction.toggle',
        expect.objectContaining({ emoji: '👍' }),
      ),
    );
  });

  it('сообщение из истории REST (нет в реплике): реакция сначала кладёт его в реплику', async () => {
    const old = msg(7);
    expect(await db.table('chatMessages').get(old.id)).toBeUndefined();
    const w = mount(MessageItem, { props: { ...base, message: old } });
    await w.trigger('pointerenter');
    await w.find('button[aria-label=Реакция]').trigger('click');
    await w
      .findAll('button')
      .find((b) => b.text() === '👍')!
      .trigger('click');
    await vi.waitFor(() =>
      expect(h_.mutate).toHaveBeenCalledWith(
        'chat.reaction.toggle',
        expect.objectContaining({ messageId: old.id }),
      ),
    );
    expect((await db.table('chatMessages').get(old.id))?.id).toBe(old.id);
  });

  it('мобильная: вместо невидимой панели — нажатие на сообщение, лист с реакциями и действиями', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {} }) as never;
    resetBreakpoint();
    try {
      const own = mount(MessageItem, { props: { ...base, message: msg(3, { authorId: ME }) } });
      await own.trigger('pointerenter');
      expect(own.find('button[aria-label=Реакция]').exists()).toBe(false);
      await own.get('.chat-body').trigger('click');
      await nextTick();
      const sheetBtn = (t: string) =>
        [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid=sheet] button')].find(
          (b) => b.textContent?.trim() === t,
        );
      expect(sheetBtn('Изменить')).toBeTruthy();
      sheetBtn('👍')!.click();
      await vi.waitFor(() =>
        expect(h_.mutate).toHaveBeenCalledWith(
          'chat.reaction.toggle',
          expect.objectContaining({ emoji: '👍' }),
        ),
      );
    } finally {
      window.matchMedia = vi
        .fn()
        .mockReturnValue({ matches: false, addEventListener() {} }) as never;
      resetBreakpoint();
    }
  });

  // CL-2b: панель действий не монтируется, пока строку не навели/не сфокусировали (быстрая прокрутка)
  it('до наведения панели нет; наведение и фокус её монтируют', async () => {
    const m = msg(3, { authorId: ME });
    const hover = mount(MessageItem, { props: { ...base, message: m } });
    expect(hover.find('button[aria-label=Удалить]').exists()).toBe(false);
    await hover.trigger('pointerenter');
    expect(hover.find('button[aria-label=Удалить]').exists()).toBe(true);
    const focus = mount(MessageItem, { props: { ...base, message: m } });
    await focus.trigger('focusin');
    expect(focus.find('button[aria-label=Удалить]').exists()).toBe(true);
  });
});

describe('редактор сообщения', () => {
  it('Enter отправляет с readId и parentId треда; вложение из uploadFile', async () => {
    const w = mount(Composer, {
      props: { channelId: CH, parentId: 'root', members: [] },
      attachTo: document.body,
    });
    w.findComponent(Editor).vm.$emit('update:modelValue', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }],
    });
    await w.find('[data-testid=chat-composer]').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const [name, a] = h_.mutate.mock.calls[0]!;
    expect(name).toBe('chat.message.send');
    expect(a).toMatchObject({ channelId: CH, parentId: 'root', attachments: [] });
    expect(a.id).not.toBe(a.readId);
    expect(() => structuredClone(a)).not.toThrow(); // реактивный прокси не клонируется в IndexedDB
  });

  it('голосовое: запись → загрузка → сообщение с вложением audio/* и длительностью', async () => {
    const stop = vi.fn();
    class FakeRecorder {
      static isTypeSupported = (t: string) => t.startsWith('audio/webm');
      state = 'inactive';
      mimeType = 'audio/webm;codecs=opus';
      ondataavailable?: (e: { data: Blob }) => void;
      onstop?: () => void;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) },
    });
    h_.upload.mockResolvedValue({ sha256: 'a'.repeat(64), mime: 'audio/webm', size: 3 });
    const w = mount(Composer, { props: { channelId: CH, members: [] } });
    await w.find('[data-testid=chat-voice]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid=chat-recording]').exists()).toBe(true);
    await w.find('[data-testid=chat-voice-send]').trigger('click');
    await flushPromises();
    expect(stop).toHaveBeenCalled();
    const file = h_.upload.mock.calls[0]![0] as File;
    expect(file.type).toBe('audio/webm');
    const [name, a] = h_.mutate.mock.calls[0]!;
    expect(name).toBe('chat.message.send');
    expect(a.attachments).toEqual([
      expect.objectContaining({ mime: 'audio/webm', size: 3, durationMs: expect.any(Number) }),
    ]);
    expect(w.find('[data-testid=chat-recording]').exists()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('отказ сервера показывается ошибкой', async () => {
    const w = mount(Composer, { props: { channelId: CH, members: [] } });
    h_.errCb!({ name: 'chat.message.send', message: 'канал в архиве' });
    await nextTick();
    expect(w.find('[role=alert]').text()).toContain('канал в архиве');
  });

  it('архивный канал — поле ввода скрыто', () => {
    const w = mount(Composer, { props: { channelId: CH, members: [], disabled: true } });
    expect(w.text()).toContain('Канал в архиве');
    expect(w.findComponent(Editor).exists()).toBe(false);
  });
});

describe('страница чата', () => {
  it('desktop: /m/chat/ открывает самый свежий канал', async () => {
    await db
      .table('chatChannels')
      .bulkPut([
        chan('old', { lastMessageAt: '2026-10-23T09:00:00.000Z' }),
        chan('fresh', { lastMessageAt: '2026-10-23T11:00:00.000Z' }),
      ]);
    mount(ChatPage);
    await vi.waitFor(() => expect(h_.push).toHaveBeenCalledWith('/m/chat/c/fresh'));
  });

  it('канал с тредом: лента и панель треда рядом', async () => {
    await db.table('chatChannels').put(chan(CH, { name: 'общий' }));
    const root = msg(1, { replyCount: 1 });
    await db.table('chatMessages').put(root);
    h_.route.params = { channelId: CH, rootId: root.id };
    h_.api.mockResolvedValue({ root, replies: [], reactions: [] });
    const w = mount(ChatPage);
    await vi.waitFor(() => expect(w.find('[data-testid=chat-thread]').exists()).toBe(true));
    expect(w.find('[data-testid=chat-title]').text()).toBe('# общий');
  });
});

// CL-2b: стоимость клиентской отправки — число обращений к IndexedDB (≈1 мс каждое) и пересчётов строки
describe('производительность', () => {
  const fakeTx = () => {
    const ops: string[] = [];
    const rows: Record<string, unknown[]> = {
      chatChannels: [chan(CH, { lastSeq: 5 })],
      chatReads: [
        { id: newId(), userId: ME, channelId: CH, lastReadSeq: 5, muted: false, updatedAt: NOW },
      ],
      spaceMembers: [{ spaceId: SPACE, userId: ME, role: 'member' }],
    };
    const tx = {
      get: async (e: string, id: string) => (
        ops.push(`get ${e}`),
        rows[e]?.find((r) => (r as { id: string }).id === id)
      ),
      scan: async (e: string) => (ops.push(`scan ${e}`), rows[e] ?? []),
      put: async (e: string) => void ops.push(`put ${e}`),
      patch: async (e: string) => void ops.push(`patch ${e}`),
    };
    return { tx, ops };
  };
  const send = (server: boolean, text: string, extra: object[] = []) => {
    const { tx, ops } = fakeTx();
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }, ...extra] }],
    };
    const run = shared.mutators.find((m) => m.name === 'chat.message.send')!.run as (
      ...a: unknown[]
    ) => Promise<void>;
    return run(
      tx,
      { id: newId(), channelId: CH, body, readId: newId() },
      { userId: ME, now: NOW, server },
    ).then(() => ops);
  };

  it('send на клиенте: без чтения участников пространства и повторных get; на сервере доступ проверяется', async () => {
    const client = await send(false, 'привет');
    expect(client).not.toContain('scan spaceMembers');
    expect(client.filter((o) => o.startsWith('patch'))).toEqual([]);
    expect(client.length).toBeLessThanOrEqual(5);
    expect(await send(true, 'привет')).toContain('scan spaceMembers');
    const mention = { type: 'mention', attrs: { id: ME, label: 'Я' } };
    expect(await send(false, 'x', [mention])).toContain('scan spaceMembers');
  });

  it('строка ленты не вызывает toLocaleTimeString (создаёт Intl-форматтер на каждую строку)', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    for (let i = 0; i < 20; i++)
      mount(MessageItem, {
        props: { message: msg(i), reactions: [], users: new Map(), me: ME, members: [] },
      });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
