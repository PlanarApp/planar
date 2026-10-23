import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from 'vue-i18n';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import type { ViewOptions } from '../..';
import { clampWidth, defaultLayout, loadLayout, moveColumn, saveLayout } from '../columns';

const h$ = vi.hoisted(() => ({
  tasks: undefined as never,
  defs: undefined as never,
  updateTask: vi.fn(async () => {}),
  setField: vi.fn(async () => {}),
}));
vi.mock('../../../fields', async (orig) => {
  const real = await orig<typeof import('../../../fields')>();
  const { ref: r } = await import('vue');
  h$.defs = r([]) as never;
  return { ...real, useFieldDefs: () => h$.defs, setTaskField: h$.setField };
});
vi.mock('../../../router', () => ({ router: { currentRoute: { value: {} }, push: vi.fn() } }));
vi.mock('../../../tasks', async (orig) => {
  const real = await orig<typeof import('../../../tasks')>();
  const { ref: r } = await import('vue');
  const { defineComponent: dc, h: hh } = await import('vue');
  const stub = (name: string) =>
    dc({
      name,
      props: ['modelValue', 'spaceId', 'compact'],
      emits: ['update:modelValue'],
      setup: () => () => hh('span', { class: name }),
    });
  h$.tasks = r([]) as never;
  return {
    ...real,
    useProjectTasks: () => h$.tasks,
    useProject: () => r({ spaceId: 's' }),
    useStatuses: () => r([]),
    useMembers: () => r([]),
    updateTask: h$.updateTask,
    setAssignees: vi.fn(),
    setLabels: vi.fn(),
    StatusPicker: stub('StatusPicker'),
    AssigneePicker: stub('AssigneePicker'),
    PriorityPicker: stub('PriorityPicker'),
    DueDatePicker: stub('DueDatePicker'),
    LabelPicker: stub('LabelPicker'),
  };
});
const View = (await import('../View.vue')).default;
const { StatusPicker } = await import('../../../tasks');
const { useSelection } = await import('../..');

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });

const opts = (o: Partial<ViewOptions> = {}): ViewOptions => ({
  groupBy: 'status',
  sortBy: 'rank',
  sortDir: 'asc',
  showSubtasks: false,
  fields: [],
  ...o,
});
const mk = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `id${n}`,
  key: `PLN-${n}`,
  title: `Task ${n}`,
  rank: `a${String(n).padStart(6, '0')}`,
  parentId: null,
  statusId: 's1',
  priority: 0,
  dueDate: null,
  startDate: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  createdBy: 'u',
  assigneeIds: [],
  labelIds: [],
  ...extra,
});
let w: VueWrapper;
const show = async (o: Partial<ViewOptions> = {}, pid = 'p1') => {
  w = mount(View, {
    props: { projectId: pid, options: opts(o) },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });
  await flushPromises();
};
const def = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `F-${id}`,
  type,
  options: {},
  projectId: 'p1',
  spaceId: 's',
  rank: id,
  ...extra,
});
const setDefs = (d: unknown[]) => ((h$.defs as { value: unknown }).value = d);
const colsMenu = async () => {
  await w
    .findAll('button')
    .find((b) => b.text() === 'Колонки')!
    .trigger('click');
  await flushPromises();
};
const menuBox = (name: string) =>
  [...document.body.querySelectorAll('label')]
    .find((l) => l.textContent!.trim() === name)!
    .querySelector('input')!;
const rows = () => w.findAll('[role=row][data-task]');

beforeEach(() => {
  w?.unmount();
  localStorage.clear();
  useSelection().clear();
  h$.updateTask.mockClear();
  h$.setField.mockClear();
  (h$.defs as { value: unknown }).value = [];
  (h$.tasks as { value: unknown }).value = [mk(1), mk(2), mk(3), mk(4, { parentId: 'id1' })];
});

describe('table', () => {
  it('table: раскладка по умолчанию', () => {
    expect(loadLayout('p1').columns.map((c) => c.id)).toEqual([
      'title',
      'key',
      'status',
      'assignee',
      'priority',
      'dueDate',
      'labels',
    ]);
  });
  it('table: сохранение и чтение раскладки; битый JSON и недоступный localStorage не ломают', () => {
    const l = defaultLayout();
    l.columns[0].width = 500;
    saveLayout('p1', l);
    expect(loadLayout('p1').columns[0].width).toBe(500);
    localStorage.setItem('planar.table.p1', '{bad');
    expect(loadLayout('p1')).toEqual(defaultLayout());
    localStorage.setItem(
      'planar.table.p1',
      JSON.stringify({
        columns: [
          { id: 'zzz', width: 100 },
          { id: 'key', width: 99 },
        ],
      }),
    );
    expect(loadLayout('p1').columns).toEqual([{ id: 'key', width: 99 }]);
    const deny = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('localStorage', { getItem: deny, setItem: deny });
    expect(loadLayout('p1')).toEqual(defaultLayout());
    expect(() => saveLayout('p1', l)).not.toThrow();
    vi.unstubAllGlobals();
  });
  it('table: ширина ограничена 60-800', () => {
    expect(clampWidth(10)).toBe(60);
    expect(clampWidth(5000)).toBe(800);
    expect(clampWidth(NaN)).toBe(60);
    localStorage.setItem(
      'planar.table.p1',
      JSON.stringify({ columns: [{ id: 'key', width: 9999 }] }),
    );
    expect(loadLayout('p1').columns[0].width).toBe(800);
  });
  it('table: перестановка колонок', async () => {
    const c = defaultLayout().columns;
    expect(
      moveColumn(c, 0, 2)
        .map((x) => x.id)
        .slice(0, 3),
    ).toEqual(['key', 'status', 'title']);
    expect(moveColumn(c, 0, 99)).toBe(c);
    await show();
    await w.get('[data-col=key] button').trigger('click');
    await flushPromises();
    const left = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Влево',
    );
    left!.click();
    await flushPromises();
    expect(w.findAll('[role=columnheader]')[0].attributes('data-col')).toBe('key');
    expect(JSON.parse(localStorage.getItem('planar.table.p1')!).columns[0].id).toBe('key');
  });
  it('table: фильтр и showSubtasks', async () => {
    await show();
    expect(rows().map((r) => r.attributes('data-task'))).toEqual(['PLN-1', 'PLN-2', 'PLN-3']);
    w.unmount();
    await show({ showSubtasks: true });
    expect(rows()).toHaveLength(4);
    w.unmount();
    await show({}, 'p1');
    w.unmount();
    w = mount(View, {
      props: {
        projectId: 'p1',
        options: opts(),
        filter: { op: 'and', rules: [{ field: 'title', operator: 'contains', value: 'Task 2' }] },
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
    });
    await flushPromises();
    expect(rows().map((r) => r.attributes('data-task'))).toEqual(['PLN-2']);
  });
  it('table: правка title вызывает мутацию task.update', async () => {
    await show();
    await w.get('[data-task="PLN-1"] [data-col=title] span').trigger('dblclick');
    const i = w.get('[data-edit]');
    await i.setValue('Новое');
    await i.trigger('keydown.enter');
    expect(h$.updateTask).toHaveBeenCalledWith('id1', { title: 'Новое' });
    expect(h$.updateTask).toHaveBeenCalledTimes(1);
  });
  it('table: Esc отменяет правку', async () => {
    await show();
    await w.get('[data-task="PLN-1"] [data-col=title] span').trigger('dblclick');
    const i = w.get('[data-edit]');
    await i.setValue('Другое');
    await i.trigger('keydown.esc');
    expect(h$.updateTask).not.toHaveBeenCalled();
  });
  it('table: массовая правка статуса для 3 выделенных - 3 мутации', async () => {
    await show();
    useSelection().set(['id1', 'id2', 'id3']);
    await flushPromises();
    w.get('[role=toolbar]').findComponent(StatusPicker).vm.$emit('update:modelValue', 's2');
    await flushPromises();
    expect(h$.updateTask).toHaveBeenCalledTimes(3);
    expect(h$.updateTask).toHaveBeenCalledWith('id2', { statusId: 's2' });
  });
  it('table: Shift-выделение диапазона', async () => {
    await show();
    await w.get('[data-task="PLN-1"] input[type=checkbox]').trigger('click');
    await w.get('[data-task="PLN-3"] input[type=checkbox]').trigger('click', { shiftKey: true });
    expect([...useSelection().selected.value].sort()).toEqual(['id1', 'id2', 'id3']);
  });
  it('table:10k - 10 000 задач, в DOM не больше 100 строк', async () => {
    (h$.tasks as { value: unknown }).value = Array.from({ length: 10000 }, (_, i) => mk(i + 1));
    const t0 = performance.now();
    await show();
    const ms = Math.round(performance.now() - t0);
    console.log(`table:10k mount ${ms} ms, rows in DOM ${rows().length}`);
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThanOrEqual(100);
    expect(ms).toBeLessThan(3000);
  });

  describe('fields', () => {
    const money = def('m1', 'money', { options: { currency: 'RUB' } });
    const sel1 = def('s1', 'select', { options: { choices: [{ id: 'c1', label: 'Красный' }] } });
    const txt = def('t1', 'text');
    const stored = (cols: unknown) =>
      localStorage.setItem('planar.table.p1', JSON.stringify({ columns: cols }));

    it('table-fields: колонки полей в меню «Колонки» и сохраняются в раскладке', async () => {
      setDefs([money, txt]);
      await show();
      expect(w.find('[data-col="field:m1"]').exists()).toBe(false);
      await colsMenu();
      const box = menuBox('F-m1');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await flushPromises();
      expect(w.find('[role=columnheader][data-col="field:m1"]').text()).toContain('F-m1');
      expect(JSON.parse(localStorage.getItem('planar.table.p1')!).columns.at(-1).id).toBe(
        'field:m1',
      );
      expect(loadLayout('p1').columns.at(-1)!.id).toBe('field:m1');
    });
    it('table-fields: раскладка с field-колонкой читается, пустой id отбрасывается', () => {
      stored([
        { id: 'field:abc', width: 200 },
        { id: 'field:', width: 100 },
        { id: 'title', width: 100 },
      ]);
      expect(loadLayout('p1').columns).toEqual([
        { id: 'field:abc', width: 200 },
        { id: 'title', width: 100 },
      ]);
    });
    it('table-fields: ячейка показывает formatFieldValue (деньги, select)', async () => {
      setDefs([money, sel1]);
      stored([
        { id: 'title', width: 200 },
        { id: 'field:m1', width: 200 },
        { id: 'field:s1', width: 200 },
      ]);
      (h$.tasks as { value: unknown }).value = [mk(1, { fields: { m1: 150000, s1: 'c1' } })];
      await show();
      const cell = (c: string) => w.get(`[data-task="PLN-1"] [data-col="${c}"]`).text();
      expect(cell('field:m1').replace(/\s/g, ' ')).toMatch(/1 500,00/);
      expect(cell('field:s1')).toBe('Красный');
    });
    it('table-fields: правка ячейки вызывает setTaskField(task, field, value)', async () => {
      setDefs([txt]);
      stored([
        { id: 'title', width: 200 },
        { id: 'field:t1', width: 200 },
      ]);
      await show();
      await w.get('[data-task="PLN-2"] [data-col="field:t1"] span').trigger('dblclick');
      const i = w.get('[data-task="PLN-2"] [data-col="field:t1"] input');
      await i.setValue('привет');
      await i.trigger('keydown.enter');
      await flushPromises();
      expect(h$.setField).toHaveBeenCalledWith('id2', 't1', 'привет');
      expect(w.find('[data-testid=field-editor]').exists()).toBe(false);
    });
    it('table-fields: Esc отменяет правку ячейки', async () => {
      setDefs([txt]);
      stored([{ id: 'field:t1', width: 200 }]);
      await show();
      await w.get('[data-task="PLN-1"] [data-col="field:t1"] span').trigger('dblclick');
      await w.get('[data-testid=field-editor]').trigger('keydown.esc');
      expect(w.find('[data-testid=field-editor]').exists()).toBe(false);
      expect(h$.setField).not.toHaveBeenCalled();
    });
    it('table-fields: массовая правка поля для 3 выделенных - 3 мутации', async () => {
      setDefs([txt]);
      await show();
      useSelection().set(['id1', 'id2', 'id3']);
      await flushPromises();
      await w.get('[data-bulk-field]').setValue('t1');
      const i = w.get('[role=toolbar] input[type=text], [role=toolbar] input:not([type])');
      await i.setValue('X');
      await flushPromises();
      expect(h$.setField).toHaveBeenCalledTimes(3);
      expect(h$.setField).toHaveBeenCalledWith('id3', 't1', 'X');
    });
    it('table-fields: колонка удалённого поля пропадает', async () => {
      setDefs([txt]);
      stored([
        { id: 'title', width: 200 },
        { id: 'field:t1', width: 200 },
      ]);
      await show();
      expect(w.find('[data-col="field:t1"]').exists()).toBe(true);
      setDefs([]);
      await flushPromises();
      expect(w.find('[data-col="field:t1"]').exists()).toBe(false);
      expect(JSON.parse(localStorage.getItem('planar.table.p1')!).columns).toHaveLength(1);
    });
  });
});
