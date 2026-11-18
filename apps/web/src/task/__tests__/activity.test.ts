import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { registerModules } from '../../modules/registry';
import { activityOf, minutesSince, type Activity } from '../../modules/activity';
import type { WorkActivity } from '../../modules/types';
import { db, ids, open, setup, until } from './h';

// PLNRAPP-202: the indicator of background work (an AI run) on the task card, its comments and checklist items
let w: VueWrapper | undefined;
let t: Awaited<ReturnType<typeof setup>>;
/** what the module's source answers now */
let answer: WorkActivity[] = [];
const load = vi.fn(async (id: string) => (id === t.id ? answer : []));
const Runs = defineComponent({ setup: () => () => h('p', { 'data-testid': 'runs-panel' }) });
registerModules([
  {
    id: 'work-test',
    taskPanels: [
      {
        id: 'runs',
        label: { ru: 'Прогоны', en: 'Runs' },
        component: async () => ({ default: Runs }),
      },
    ],
    activity: [{ id: 'tasks', entity: 'tasks', load }],
  },
]);
const BOT = crypto.randomUUID();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const run = (o: Partial<WorkActivity> = {}): WorkActivity => ({
  id: crypto.randomUUID(),
  itemId: null,
  state: 'running',
  actorId: BOT,
  startedAt: ago(0),
  panel: 'runs',
  ...o,
});
const comment = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  spaceId: ids.space,
  taskId: t.id,
  authorId: ids.ann,
  body: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'вопрос' }] }],
  },
  mentions: [],
  editedAt: null,
  createdAt: ago(1),
  updatedAt: ago(1),
  ...over,
});
const status = (sel = '') => w!.find(`${sel} [data-testid="work-status"]`.trim());

beforeEach(async () => {
  t = await setup();
  answer = [];
  load.mockClear();
});
afterEach(() => {
  w?.unmount();
  w = undefined;
});

describe('activity: выбор состояния', () => {
  const a = (state: WorkActivity['state'], itemId: string | null = 'c1') =>
    ({ ...run({ state, itemId }), moduleId: 'm' }) as Activity;
  it('у пункта — сначала идущий прогон, потом ожидание, очередь, ошибка, готово', () => {
    const f = a('failed');
    const wt = a('waiting_human');
    const r = a('running');
    const q = a('queued');
    const d = a('done');
    expect(activityOf([d, f, q, wt], 'c1')).toBe(wt);
    expect(activityOf([d, f, q], 'c1')).toBe(q);
    expect(activityOf([d, f], 'c1')).toBe(f);
    expect(activityOf([d], 'c1')).toBe(d);
    expect(activityOf([f, wt, r], 'c1')).toBe(r);
    expect(activityOf([f, wt], 'c1')).toBe(wt);
    expect(activityOf([f], 'c1')).toBe(f);
    expect(activityOf([f], 'c2')).toBeUndefined();
    // without an item — of the whole task
    const other = a('running', null);
    expect(activityOf([f, other])).toBe(other);
  });
  it('минуты с начала прогона', () => {
    const t0 = '2026-11-12T10:00:00.000Z';
    expect(minutesSince(t0, Date.parse('2026-11-12T10:05:59.000Z'))).toBe(5);
    expect(minutesSince(t0, Date.parse('2026-11-12T09:59:00.000Z'))).toBe(0);
  });
});

describe('task: индикатор работы ИИ', () => {
  const aiRow = () => w!.find('[data-testid="task-ai-state"]');
  it('строка «ИИ» под «Статусом»: работает — без кольца у статуса; запусков нет — строки нет', async () => {
    answer = [run({ agent: true, startedAt: ago(5.5) })];
    w = await open();
    await until(() => aiRow().exists());
    expect(load).toHaveBeenCalledWith(t.id);
    expect(aiRow().text()).toBe('Работает');
    expect(w.find('[data-testid="status-pill"]').classes()).not.toContain('work-ring');
    expect(w.find('[data-testid="task-props"] [data-testid="work-status"]').exists()).toBe(false);
    // no runs left: the row is gone
    answer = [];
    await db.table('comments').put(comment({ authorId: BOT }));
    await until(() => !aiRow().exists());
  });

  it.each([
    ['queued', 'Ждёт'],
    ['waiting_human', 'Ждёт ответа'],
    ['done', 'Готово'],
    ['failed', 'Ошибка'],
  ] as const)('строка «ИИ»: %s — «%s»; клик открывает панель запусков', async (state, text) => {
    answer = [run({ state })];
    w = await open();
    await until(() => aiRow().exists());
    expect(aiRow().text()).toBe(text);
    expect(aiRow().attributes('data-state')).toBe(state);
    await aiRow().trigger('click');
    await until(() => w!.find('[data-testid="runs-panel"]').exists());
  });

  it('PLNRAPP-310: задача в очереди к ИИ — «Ждёт»; задание стартовало — «Работает» без изменения реплики', async () => {
    answer = [run({ state: 'queued', itemId: null })];
    w = await open();
    await until(() => aiRow().exists());
    expect(aiRow().attributes('data-state')).toBe('queued');
    // the queue is polled: the started run replaces the queued job without a replica change
    answer = [run({ agent: true, itemId: null, startedAt: ago(0) })];
    await until(() => aiRow().attributes('data-state') === 'running', 6000);
    expect(aiRow().text()).toBe('Работает');
  }, 10_000);

  it('PLNRAPP-532: задание взято, прогон ещё не записан — опрос не останавливается и видит прогон', async () => {
    answer = [run({ state: 'queued', itemId: null })];
    w = await open();
    await until(() => aiRow().exists());
    const before = load.mock.calls.length;
    // the job is taken, its run is not in the DB yet: nothing live for a moment
    answer = [];
    await until(() => load.mock.calls.length > before && !aiRow().exists(), 6000);
    answer = [run({ itemId: null, startedAt: ago(0) })];
    await until(() => aiRow().exists() && aiRow().attributes('data-state') === 'running', 6000);
  }, 15_000);

  it('«Ждёт» — «Отменить»: ожидание отменено и сразу скрыто; без cancel — кнопки нет', async () => {
    const cancel = vi.fn(async () => {});
    answer = [run({ state: 'queued', itemId: null, cancel })];
    w = await open();
    await until(() => aiRow().exists());
    answer = [];
    await w.find('[data-testid="task-ai-cancel"]').trigger('click');
    expect(cancel).toHaveBeenCalledOnce();
    await until(() => !aiRow().exists());
    w.unmount();
    answer = [run({ state: 'queued', itemId: null })];
    w = await open();
    await until(() => aiRow().exists());
    expect(w.find('[data-testid="task-ai-cancel"]').exists()).toBe(false);
  });

  it('комментарий, на который отвечает ИИ: кольцо у его аватара; ошибка — ссылка на прогон', async () => {
    const c = comment({ assigneeId: BOT });
    await db.table('comments').put(c);
    answer = [run({ itemId: c.id })];
    w = await open();
    const at = `[data-comment="${c.id}"]`;
    await until(() => status(at).exists());
    expect(status(at).text()).toContain('ИИ отвечает…');
    expect(w.find(`${at} .work-ring`).exists()).toBe(true);
    answer = [run({ itemId: c.id, state: 'failed' })];
    await db.table('comments').put({ ...c, updatedAt: ago(0) });
    await until(() => status(at).attributes('data-state') === 'failed');
    expect(status(at).text()).toContain('Ошибка ИИ');
    expect(w.find(`${at} .work-ring`).exists()).toBe(false);
    await w.find(`${at} [data-testid="work-open-run"]`).trigger('click');
    await until(() => w!.find('[data-testid="runs-panel"]').exists());
  });

  it('PLNRAPP-400: индикатор — под комментарием-триггером, не в начале; у триггера-ответа — в подтреде', async () => {
    const root = comment({ createdAt: ago(3) });
    const reply = comment({ parentId: root.id, assigneeId: BOT, createdAt: ago(2) });
    await db.table('comments').bulkPut([root, reply]);
    answer = [run({ itemId: reply.id })];
    w = await open();
    const at = `[data-comment="${reply.id}"]`;
    await until(() => status(at).exists());
    // the reply's own indicator is inside the root's thread, under the reply's text
    expect(w.find(`[data-comment="${root.id}"] [data-testid="thread"] ${at}`).exists()).toBe(true);
    const body = w.find(`${at} [data-testid="comment-body"]`).element;
    const work = w.find(`${at} [data-testid="comment-work"]`).element;
    expect(body.firstElementChild).not.toBe(work);
    expect(body.lastElementChild).toBe(work);
    expect(w.findAll('[data-testid="comment-work"]')).toHaveLength(1);
  });

  it('источник недоступен (нет прав, модуль выключен) — индикатора нет', async () => {
    load.mockRejectedValueOnce(new Error('404'));
    w = await open();
    await until(() => load.mock.calls.length > 0);
    expect(status().exists()).toBe(false);
  });
});
