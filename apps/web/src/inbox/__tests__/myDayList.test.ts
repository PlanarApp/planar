// PLNRAPP-864, PLNRAPP-868: «My day» — the List with the day filter (my unfinished tasks with a due date) in the
// blocks «Today / Tomorrow / Later»
import 'fake-indexeddb/auto';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { reactive } from 'vue';
import { domainMutators } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { ids, id, reset, task, until } from '../../tasks/__tests__/data';
import { resetBreakpoint } from '../../ui';
import { useAuth } from '../../auth/useAuth';
import type { ViewOptions } from '../../views';
import { localToday } from '../../views/filter';

vi.mock('../../router', async () => {
  const vr = await import('vue-router');
  const stub = { template: '<div />' };
  return {
    router: vr.createRouter({
      history: vr.createMemoryHistory(),
      routes: [{ path: '/:p(.*)*', component: stub }],
    }),
  };
});
const MyDay = (await import('../MyDay.vue')).default;
const { setDue } = await import('../myDay');
const { useSelection } = await import('../../views');

// happy-dom doesn't compute the layout: give the list the window height and width
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1600 });

const opts = (): ViewOptions => ({
  groupBy: 'none',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
  showKey: true,
  showEmpty: true,
  fields: ['status', 'assignee', 'priority', 'dueDate'],
  // the level's List Me Mode is not applied in «My day»
  me: 'created',
});

let w: VueWrapper;
let options: ViewOptions;
const show = async () => {
  options = reactive(opts());
  w = mount(MyDay, {
    props: {
      projectId: 's:x:me-day',
      scope: { projectIds: [ids.project], spaceIds: [ids.space] },
      options,
    },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });
};
const titles = () =>
  w.findAll('[role=row][data-task] [data-testid=row-title]').map((x) => x.text());
const mineTask = async (n: number, o: Record<string, unknown>, assignee = ids.ann) => {
  const t = task(n, { title: `T${n}`, ...o });
  await db.table('tasks').put(t);
  await db.table('taskAssignees').put({
    id: id(),
    taskId: t.id,
    userId: assignee,
    spaceId: ids.space,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  });
  return t.id;
};

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {} }) as never;
  resetBreakpoint();
  useSelection().clear();
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
  useAuth().user.value = (await db.table('users').get(ids.ann)) as never;
});
afterEach(() => w?.unmount());

/** block → titles of its rows, in the order of the list */
const blocks = () => {
  const out: Record<string, string[]> = {};
  let cur = '';
  for (const r of w.findAll('[role=row]')) {
    if (r.attributes('data-testid') === 'group-row') {
      cur = r.get('h3').text();
      out[cur] = [];
    } else if (r.attributes('data-task') !== undefined)
      out[cur]!.push(r.get('[data-testid=row-title]').text());
  }
  return out;
};

describe('PLNRAPP-868 «Мой день» — блоки «Сегодня / Завтра / Потом»', () => {
  it('просроченная и сегодняшняя — в «Сегодня», завтрашняя — в «Завтра», через 3 дня — в «Потом»; без срока, закрытые и чужие — нет', async () => {
    await mineTask(1, { dueDate: localToday(-1) });
    await mineTask(2, { dueDate: localToday() });
    await mineTask(3, { dueDate: localToday(1) });
    await mineTask(4, { dueDate: localToday(3) });
    await mineTask(5, {});
    await mineTask(6, { dueDate: localToday(), statusId: ids.done });
    await mineTask(7, { dueDate: localToday(-1), statusId: ids.done });
    await mineTask(8, { dueDate: localToday() }, ids.bob);
    await show();
    await until(() => titles().length === 4);
    expect(blocks()).toEqual({ Сегодня: ['T1', 'T2'], Завтра: ['T3'], Позже: ['T4'] });
  });

  it('группировка и сортировка «Вида» не применяются: блоки по сроку, внутри — по сроку', async () => {
    await mineTask(1, { dueDate: localToday(5), priority: 1 });
    await mineTask(2, { dueDate: localToday(2), priority: 4 });
    await show();
    options.groupBy = 'priority';
    options.sortBy = 'priority';
    await until(() => titles().length === 2);
    expect(blocks()).toEqual({ Сегодня: [], Завтра: [], Позже: ['T2', 'T1'] });
  });

  it('смена срока сразу переносит задачу между блоками; срок убран или задача закрыта — уходит', async () => {
    const t1 = await mineTask(1, { dueDate: localToday() });
    const t2 = await mineTask(2, { dueDate: localToday(4) });
    await show();
    await until(() => blocks()['Сегодня']?.join() === 'T1');
    await setDue(t1, localToday(1));
    await until(() => blocks()['Завтра']?.join() === 'T1');
    await setDue(t2, localToday(-2));
    await until(() => blocks()['Сегодня']?.join() === 'T2');
    await setDue(t1, null);
    await until(() => titles().join() === 'T2');
    await db.table('tasks').put({ ...(await db.table('tasks').get(t2)), statusId: ids.done });
    await until(() => titles().length === 0);
  });

  it('карточки — строки Списка: свойства меню «Вид» применяются сразу, без кнопки «убрать из дня»', async () => {
    await mineTask(1, { dueDate: localToday(), priority: 2 });
    await show();
    await until(() => titles().length === 1);
    const row = () => w.get('[role=row][data-task]');
    expect(row().find('[data-col=priority]').exists()).toBe(true);
    expect(row().find('[data-testid=row-key]').exists()).toBe(true);
    options.fields = options.fields.filter((f) => f !== 'priority');
    await until(() => !row().find('[data-col=priority]').exists());
    options.fields = [...options.fields, 'priority'];
    await until(() => row().find('[data-col=priority]').exists());
    options.showKey = false;
    await until(() => !row().find('[data-testid=row-key]').exists());
    expect(w.find('[data-testid=my-day-remove]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/убрать из/i);
  });

  it('блоки — секции, а не аккордеон: без кнопки сворачивания', async () => {
    await mineTask(1, { dueDate: localToday() });
    await show();
    await until(() => titles().length === 1);
    expect(w.findAll('[data-testid=group-row]')).toHaveLength(3);
    expect(w.find('[data-testid=group-row] button[aria-expanded]').exists()).toBe(false);
  });

  it('«Все на завтра» переносит весь блок «Сегодня» с просроченными; кнопка только у непустого «Сегодня»', async () => {
    await mineTask(1, { dueDate: localToday(-2) });
    await mineTask(2, { dueDate: localToday() });
    await mineTask(3, { dueDate: localToday(3) });
    await show();
    await until(() => titles().length === 3);
    expect(w.findAll('[data-testid=my-day-all-tomorrow]')).toHaveLength(1);
    await w.get('[data-testid=my-day-all-tomorrow]').trigger('click');
    await until(() => blocks()['Завтра']?.join() === 'T1,T2');
    expect(blocks()).toEqual({ Сегодня: [], Завтра: ['T1', 'T2'], Позже: ['T3'] });
    expect(w.find('[data-testid=my-day-all-tomorrow]').exists()).toBe(false);
  });
});
