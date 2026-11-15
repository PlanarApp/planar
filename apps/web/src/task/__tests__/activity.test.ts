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
  it('у пункта — сначала идущий прогон, потом ожидание, потом ошибка', () => {
    const f = a('failed');
    const wt = a('waiting_human');
    const r = a('running');
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
  it('агент работает — кольцо у статуса и «агент работает N мин»; завершён — пропадает', async () => {
    answer = [run({ agent: true, startedAt: ago(5.5) })];
    w = await open();
    await until(() => status().exists());
    expect(load).toHaveBeenCalledWith(t.id);
    expect(status().text()).toContain('Агент работает 5 мин');
    expect(w.find('[data-testid="status-pill"]').classes()).toContain('work-ring');
    // the run ended with the bot's comment: the replica change reloads the work
    answer = [];
    await db.table('comments').put(comment({ authorId: BOT }));
    await until(() => !status().exists());
    expect(w.find('[data-testid="status-pill"]').classes()).not.toContain('work-ring');
  });

  it('ждёт человека — статус без анимации', async () => {
    answer = [run({ state: 'waiting_human' })];
    w = await open();
    await until(() => status().exists());
    expect(status().text()).toContain('ИИ ждёт ответа');
    expect(w.find('[data-testid="status-pill"]').classes()).not.toContain('work-ring');
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

  it('источник недоступен (нет прав, модуль выключен) — индикатора нет', async () => {
    load.mockRejectedValueOnce(new Error('404'));
    w = await open();
    await until(() => load.mock.calls.length > 0);
    expect(status().exists()).toBe(false);
  });
});
