import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount as vmount } from '@vue/test-utils';
import { Editor } from '@tiptap/vue-3';

// Tooltip requires a TooltipProvider (the app wraps it in App.vue) — tests skip the wrapper
const mount = ((c: never, o: object = {}) =>
  vmount(c, {
    ...o,
    global: { plugins: [i18n], stubs: { Tooltip: { template: '<slot />' } } },
  })) as unknown as typeof vmount;
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { uuidv7, domainMutators } from '@planar/shared';
import { db, mutate, i18n, slashItems } from '@planar/web/modules';
// sync internals are needed only by the test, the SDK does not have them
import { moduleMutators, registerMutators, startSync, stopSync } from '../../../apps/web/src/sync';
import { web } from './index';
import { moveArgs, type PageRow } from './model';
import TaskPanel from './TaskPanel.vue';
import PageView from './PageView.vue';
import TreeSection from './TreeSection.vue';
import GroupDocs from './GroupDocs.vue';

const ME = uuidv7();
const OTHER = uuidv7();
const SPACE = uuidv7();
const NOW = '2026-10-23T10:00:00.000Z';
vi.mock('@planar/web/modules', async (orig) => {
  const { ref } = await import('vue');
  return { ...(await orig<object>()), useSession: () => ref({ id: (globalThis as Record<string, unknown>).__ME }) };
});
(globalThis as unknown as { __ME: string }).__ME = ME;
// intercepting onDenied: the test simulates exhausting connection attempts
vi.mock('@planar/editor/collab', async (orig) => {
  const m = await orig<typeof import('@planar/editor/collab')>();
  return {
    ...m,
    openCollab: (...a: Parameters<typeof m.openCollab>) => {
      const c = m.openCollab(...a);
      return {
        ...c,
        onDenied: (cb: () => void) => {
          (globalThis as Record<string, unknown>).__denied = cb;
          c.onDenied(cb);
        },
      };
    },
  };
});
const router = { push: vi.fn(), replace: vi.fn() };
vi.mock('vue-router', async (orig) => ({
  ...(await orig<object>()),
  useRouter: () => router,
  useRoute: () => ({ params: {}, query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}));

const page = (id: string, o: Partial<PageRow & { body: unknown }> = {}) => ({
  id,
  spaceId: SPACE,
  projectId: null,
  parentId: null,
  rank: 'a0',
  title: id,
  icon: null,
  body: { type: 'doc', content: [] },
  text: '',
  files: [],
  createdBy: ME,
  updatedBy: ME,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

beforeAll(async () => {
  i18n.global.locale.value = 'ru';
  registerMutators([...domainMutators, ...moduleMutators]);
  await startSync({
    userId: ME,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
});
afterAll(() => stopSync());
beforeEach(async () => {
  for (const t of ['docsPages', 'docsTaskLinks', 'docsLocks', 'tasks', 'users', 'spaces'])
    await db.table(t).clear();
  await db.table('spaceMembers').put({
    id: uuidv7(),
    spaceId: SPACE,
    userId: ME,
    role: 'member',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.table('users').bulkPut([
    { id: ME, name: 'Я' },
    { id: OTHER, name: 'Анна' },
  ]);
});

describe('docs web: манифест и провайдер поиска', () => {
  it('точки расширения: маршрут, секция, панель задачи, поиск', () => {
    expect(web.id).toBe('docs');
    expect(web.routes![0]!.path).toBe('/m/docs/:pageId?');
    expect(web.groupTabs![0]).toMatchObject({ id: 'pages', tab: 'docs', component: expect.any(Function) });
    expect(web.taskPanels![0]!.id).toBe('pages');
    expect(web.search![0]!.id).toBe('pages');
  });

  it('поиск находит по title и по text локальной реплики, ё=е, ведёт на /m/docs/<id>', async () => {
    const a = uuidv7();
    const b = uuidv7();
    await db.table('docsPages').bulkPut([
      page(a, { title: 'Ёжик', text: '' }),
      page(b, { title: 'План', text: 'встреча в четверг, ёлка' }),
    ]);
    const s = web.search![0]!;
    expect((await s.search('ежик', 5)).map((h) => h.to)).toEqual([`/m/docs/${a}`]);
    expect((await s.search('ёлк', 5)).map((h) => h.id)).toEqual([b]);
    expect(await s.search('нету', 5)).toEqual([]);
  });
});

describe('docs web: вкладка «Документы»', () => {
  it('PLNRAPP-75 без страницы — по центру кнопка «Новая страница»: создаёт страницу уровня и открывает', async () => {
    await db.table('spaces').put({ id: SPACE, name: 'Космос', rank: 'a0' });
    const w = mount(GroupDocs, {
      props: { scope: { level: 'space', spaceId: SPACE, projectId: null, rootSpaceId: SPACE } },
    });
    const btn = await vi.waitFor(() => {
      const b = w.find('[data-testid=docs-empty-new]');
      expect(b.exists()).toBe(true);
      return b;
    });
    router.push.mockClear();
    await btn.trigger('click');
    await vi.waitFor(() => expect(router.push).toHaveBeenCalled());
    const [p] = await db.table<PageRow>('docsPages').toArray();
    expect(p).toMatchObject({ spaceId: SPACE, parentId: null });
    expect(router.push).toHaveBeenCalledWith({ query: { page: p!.id } });
  });
});

describe('docs web: дерево в боковой панели', () => {
  it('рисует неархивные страницы пространства по rank, архивные скрыты', async () => {
    await db.table('spaces').put({ id: SPACE, name: 'Космос', rank: 'a0' });
    await db.table('docsPages').bulkPut([
      page(uuidv7(), { title: 'Вторая', rank: 'a1' }),
      page(uuidv7(), { title: 'Первая', rank: 'a0' }),
      page(uuidv7(), { title: 'Старая', rank: 'a2', archivedAt: NOW }),
    ]);
    const w = mount(TreeSection);
    await vi.waitFor(() => expect(w.text()).toContain('Первая'));
    const titles = w.findAll('a').map((a) => a.text());
    expect(titles).toEqual(['Первая', 'Вторая']);
    expect(w.text()).toContain('Космос');
  });

  it('перенос через docs.page.move: страница уходит в потомки цели с rank после соседей', async () => {
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    await db.table('docsPages').bulkPut([
      page(a, { rank: 'a0' }),
      page(b, { rank: 'a1', parentId: a }),
      page(c, { rank: 'a2' }),
    ]);
    const all = await db.table<PageRow>('docsPages').toArray();
    const args = moveArgs(all, c, a, 'into')!;
    await mutate('docs.page.move', args);
    const moved = await db.table('docsPages').get(c);
    expect(moved).toMatchObject({ parentId: a });
    expect(moved.rank > 'a1').toBe(true);
    // a cycle is rejected by the client too
    expect(moveArgs(all, a, b, 'into')).toBeNull();
  });
});

describe('docs web: панель задачи', () => {
  async function seedTask() {
    const t = uuidv7();
    await db.table('tasks').put({ id: t, spaceId: SPACE, title: 'Релиз', createdAt: NOW, updatedAt: NOW });
    return t;
  }
  const panel = (taskId: string) => mount(TaskPanel, { props: { taskId } });

  it('показывает связанные страницы; связывает по поиску title; отвязывает', async () => {
    const t = await seedTask();
    const [p1, p2] = [uuidv7(), uuidv7()];
    await db.table('docsPages').bulkPut([page(p1, { title: 'Заметки' }), page(p2, { title: 'Спецификация' })]);
    await db.table('docsTaskLinks').put({
      id: uuidv7(), spaceId: SPACE, pageId: p1, taskId: t, createdBy: ME, createdAt: NOW,
    });
    const w = panel(t);
    await vi.waitFor(() => expect(w.text()).toContain('Заметки'));
    expect(w.text()).not.toContain('Спецификация');

    await w.find('input').setValue('специф');
    await vi.waitFor(() => expect(w.find('[role=option]').exists()).toBe(true));
    await w.find('[role=option]').trigger('mousedown');
    await vi.waitFor(() => expect(w.text()).toContain('Спецификация'));
    expect(await db.table('docsTaskLinks').count()).toBe(2);

    await w.find('button[aria-label="Отвязать"]').trigger('click');
    await vi.waitFor(async () => expect(await db.table('docsTaskLinks').count()).toBe(1));
  });

  it('«Создать страницу» делает страницу с названием задачи, связь и переход', async () => {
    const t = await seedTask();
    const w = panel(t);
    await flushPromises();
    await w.find('button:not([aria-label])').trigger('click');
    await vi.waitFor(() => expect(router.push).toHaveBeenCalled());
    const pages = await db.table('docsPages').toArray();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ title: 'Релиз', spaceId: SPACE });
    expect(await db.table('docsTaskLinks').where('taskId').equals(t).count()).toBe(1);
  });
});

describe('docs web: совместное редактирование (DC-web v2)', () => {
  const queued = (name: string) => db._queue.filter((q) => q.name === name).count();
  const editorOf = (w: ReturnType<typeof mount>) =>
    (w.findComponent({ name: 'DocEditor' }).vm as unknown as { editor: Editor | null }).editor;

  it('редактор открывается сразу редактируемым: без плашки «редактирует», без docs.lock', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const n0 = await queued('docs.lock');
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(w.find('.ProseMirror').exists()).toBe(true), {
      timeout: 10_000,
    });
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('true');
    expect(w.find('[data-testid=doc-lock]').exists()).toBe(false);
    expect((w.find('[data-testid=doc-title]').element as HTMLInputElement).disabled).toBe(false);
    w.unmount();
    expect(await queued('docs.lock')).toBe(n0);
    expect(await queued('docs.unlock')).toBe(0);
  });

  it('чужая запись блокировки не мешает: страница не переходит в режим чтения', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    await db.table('docsLocks').put({
      id,
      spaceId: SPACE,
      userId: OTHER,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(w.find('.ProseMirror').exists()).toBe(true), {
      timeout: 10_000,
    });
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('true');
    expect(w.find('[data-testid=doc-lock]').exists()).toBe(false);
    w.unmount();
  });

  it('доступ не получен после повторов: редактор остаётся редактируемым, «Не синхронизируется» + «Повторить»', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(editorOf(w)).toBeTruthy(), { timeout: 10_000 });
    expect(w.find('[data-testid=unsynced]').exists()).toBe(false);
    ((globalThis as Record<string, unknown>).__denied as () => void)();
    await flushPromises();
    expect(w.find('[data-testid=unsynced]').text()).toContain('Не синхронизируется');
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('true');
    await w.find('[data-testid=unsynced] button').trigger('click');
    expect(w.find('[data-testid=unsynced]').exists()).toBe(false);
    w.unmount();
  });

  it('документ подключается как docs:<pageId>', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(editorOf(w)).toBeTruthy(), { timeout: 10_000 });
    expect(w.findComponent({ name: 'DocEditor' }).props('name')).toBe(`docs:${id}`);
    w.unmount();
  });
});

describe('docs web: slash-меню и редактор', () => {
  const mk = () =>
    new Editor({
      extensions: [StarterKit, Table, TableRow, TableHeader, TableCell, TaskList, TaskItem],
    });
  const run = (e: Editor, id: string) =>
    slashItems.find((i) => i.id === id)!.run(e, { pickImage: () => {} });

  it('«Таблица» вставляет таблицу 3×3 с шапкой', () => {
    const e = mk();
    run(e, 'table');
    const doc = JSON.stringify(e.getJSON());
    expect(doc).toContain('"table"');
    expect(doc.match(/"tableHeader"/g)).toHaveLength(3);
    expect(doc.match(/"tableCell"/g)).toHaveLength(6);
    e.destroy();
  });

  it('«Чек-лист» и «Заголовок 2» превращают абзац', () => {
    const e = mk();
    run(e, 'todo');
    expect(e.getJSON().content![0]!.type).toBe('taskList');
    e.destroy();
    const e2 = mk();
    run(e2, 'h2');
    expect(e2.getJSON().content![0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    e2.destroy();
  });

  it('тело правится через Yjs: docs.page.update с body из редактора не уходит', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(w.find('.ProseMirror').exists()).toBe(true), {
      timeout: 10_000,
    });
    const ed = (w.findComponent({ name: 'DocEditor' }).vm as unknown as { editor: Editor }).editor;
    const n0 = await db._queue.filter((q) => q.name === 'docs.page.update').count();
    ed.commands.insertContent('Привет');
    expect(ed.getText()).toBe('Привет');
    await new Promise((r) => setTimeout(r, 1200));
    expect(await db._queue.filter((q) => q.name === 'docs.page.update').count()).toBe(n0);
    expect((await db.table('docsPages').get(id)).text).toBe('');
    w.unmount();
  });

  it('уход со страницы сразу сохраняет несохранённое', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(w.find('.ProseMirror').exists()).toBe(true), {
      timeout: 10_000,
    });
    await flushPromises();
    const input = w.find('[data-testid=doc-title]');
    await input.setValue('Новое имя');
    w.unmount();
    await vi.waitFor(async () => expect((await db.table('docsPages').get(id)).title).toBe('Новое имя'));
  });
});
