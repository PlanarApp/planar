import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { uuidv7, domainMutators } from '@planar/shared';
import { db, mutate, i18n } from '@planar/web/modules';
// внутренности синка нужны только тесту, в SDK их нет
import { moduleMutators, registerMutators, startSync, stopSync } from '../../../apps/web/src/sync';
import { web } from './index';
import { slashItems } from './slash';
import { moveArgs, type PageRow } from './model';
import { useLock } from './lock';
import TaskPanel from './TaskPanel.vue';
import PageView from './PageView.vue';
import TreeSection from './TreeSection.vue';

const ME = uuidv7();
const OTHER = uuidv7();
const SPACE = uuidv7();
const NOW = '2026-10-23T10:00:00.000Z';
vi.mock('@planar/web/modules', async (orig) => {
  const { ref } = await import('vue');
  return { ...(await orig<object>()), useSession: () => ref({ id: globalThis.__ME }) };
});
(globalThis as unknown as { __ME: string }).__ME = ME;
const router = { push: vi.fn(), replace: vi.fn() };
vi.mock('vue-router', async (orig) => ({
  ...(await orig<object>()),
  useRouter: () => router,
  useRoute: () => ({ params: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}));

const page = (id: string, o: Partial<PageRow & { body: unknown }> = {}) => ({
  id,
  spaceId: SPACE,
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
    expect(web.nav![0]).toMatchObject({ id: 'tree', section: expect.any(Function) });
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
    // цикл отклоняется и клиентом
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

describe('docs web: блокировка', () => {
  const lockRow = (pageId: string, userId: string, ms: number) => ({
    id: pageId,
    spaceId: SPACE,
    userId,
    expiresAt: new Date(Date.now() + ms).toISOString(),
  });

  it('чужая действующая блокировка: плашка «Редактирует Анна», редактор только для чтения', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id, { title: 'Док' }));
    await db.table('docsLocks').put(lockRow(id, OTHER, 60_000));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(w.find('[data-testid=doc-lock]').text()).toContain('Редактирует Анна'));
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('false');
    expect((w.find('[data-testid=doc-title]').element as HTMLInputElement).disabled).toBe(true);
    // чужую блокировку не затираем
    expect((await db.table('docsLocks').get(id)).userId).toBe(OTHER);
    w.unmount();
  });

  it('своя/свободная: редактор доступен, docs.lock ставит строку, при закрытии docs.unlock снимает', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(async () => expect((await db.table('docsLocks').get(id))?.userId).toBe(ME));
    await flushPromises();
    expect(w.find('[data-testid=doc-lock]').exists()).toBe(false);
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('true');
    w.unmount();
    await vi.waitFor(async () => expect(await db.table('docsLocks').get(id)).toBeUndefined());
  });

  it('истёкшая чужая блокировка не мешает', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    await db.table('docsLocks').put(lockRow(id, OTHER, -1000));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(async () => expect((await db.table('docsLocks').get(id))?.userId).toBe(ME));
    expect(w.find('[data-testid=doc-lock]').exists()).toBe(false);
    w.unmount();
  });

  it('продление каждые 60 с: ещё один docs.lock в очереди', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const locks = () => db._queue.filter((q) => q.name === 'docs.lock').count();
    const n0 = await locks();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const C = defineComponent({
      setup() {
        useLock(
          () => id,
          () => ME,
        );
        return () => h('i');
      },
    });
    const w = mount(C);
    await vi.waitFor(async () => expect(await locks()).toBe(n0 + 1));
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await locks()).toBe(n0 + 2));
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

  it('правка в редакторе уходит в docs.page.update с debounce 800 мс, тело сохраняется', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(w.find('.ProseMirror').exists()).toBe(true));
    await vi.waitFor(async () => expect((await db.table('docsLocks').get(id))?.userId).toBe(ME));
    await flushPromises();
    const ed = (w.findComponent({ name: 'DocEditor' }).vm as unknown as { editor: Editor }).editor;
    ed.commands.insertContent('Привет');
    await new Promise((r) => setTimeout(r, 300));
    expect((await db.table('docsPages').get(id)).text).toBe('');
    await vi.waitFor(async () => expect((await db.table('docsPages').get(id)).text).toBe('Привет'));
    w.unmount();
  });

  it('уход со страницы сразу сохраняет несохранённое', async () => {
    const id = uuidv7();
    await db.table('docsPages').put(page(id));
    const w = mount(PageView, { props: { pageId: id } });
    await vi.waitFor(() => expect(w.find('.ProseMirror').exists()).toBe(true));
    await flushPromises();
    const input = w.find('[data-testid=doc-title]');
    await input.setValue('Новое имя');
    w.unmount();
    await vi.waitFor(async () => expect((await db.table('docsPages').get(id)).title).toBe('Новое имя'));
  });
});
