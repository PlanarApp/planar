import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import type { PlanarDB } from '../../../sync/db';
import ConditionsEditor from '../../../../../../modules/automations/web/ConditionsEditor.vue';
import RulesPage from '../../../../../../modules/automations/web/RulesPage.vue';
import { fetchRuns } from '../../../../../../modules/automations/web/data';
import * as shared from '../../../../../../modules/automations/shared/index';

const mutate = vi.hoisted(() => vi.fn(async () => {}));
const h = vi.hoisted(() => ({ db: undefined as unknown as PlanarDB }));
vi.mock('../../../sync', async () => {
  const { PlanarDB } = await import('../../../sync/db');
  const { useQuery } = await import('../../../sync/query');
  h.db = new PlanarDB('wk3', { automationsRules: ['spaceId', 'projectId'] });
  return { db: h.db, mutate, registerMutators: vi.fn(), useQuery, newId: () => 'new-id' };
});
const SP = uuidv7();
const P = uuidv7();
const S1 = uuidv7();
vi.mock('../../../tasks', () => ({
  useSpaces: () => ref([{ id: SP, projects: [{ id: P, spaceId: SP, name: 'Проект' }] }]),
  useStatuses: () => ref([{ id: S1, name: 'В работе', category: 'in_progress' }]),
  useMembers: () => ref([]),
  useLabels: () => ref([]),
}));

const T = '2026-10-20T10:00:00.000Z';
const ruleRow = (over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  spaceId: SP,
  projectId: P,
  name: 'Правило',
  enabled: true,
  trigger: { type: 'task.created' },
  conditions: { op: 'and', rules: [] },
  actions: [{ type: 'add_comment', text: 'привет' }],
  createdBy: uuidv7(),
  createdAt: T,
  updatedAt: T,
  ...over,
});

beforeAll(async () => {
  await h.db.open();
});
beforeEach(async () => {
  mutate.mockClear();
  await Promise.all(h.db.tables.map((t) => t.clear()));
});
afterEach(() => vi.restoreAllMocks());

describe('wk3: схемы', () => {
  it('wk3: trigger/action/filter — верные принимаются, send_webhook и мусор нет', () => {
    const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
      s.safeParse(v).success;
    expect(ok(shared.triggerSchema, { type: 'task.due', daysBefore: 30 })).toBe(true);
    expect(ok(shared.triggerSchema, { type: 'task.due', daysBefore: 31 })).toBe(false);
    expect(ok(shared.triggerSchema, { type: 'x' })).toBe(false);
    expect(ok(shared.actionSchema, { type: 'set_field', field: 'dueDate', value: 'today+2' })).toBe(
      true,
    );
    expect(ok(shared.actionSchema, { type: 'set_field', field: 'priority', value: 7 })).toBe(false);
    expect(ok(shared.actionSchema, { type: 'send_webhook', subscriptionId: uuidv7() })).toBe(false);
    expect(ok(shared.filterSchema, { op: 'and', rules: [] })).toBe(true);
    expect(ok(shared.filterSchema, { op: 'and', rules: [{ field: 'nope', operator: 'in' }] })).toBe(
      false,
    );
  });
});

describe('wk3: страница правил', () => {
  it('wk3: список правил проекта; переключатель вызывает automations.update', async () => {
    await h.db
      .table('automationsRules')
      .bulkPut([ruleRow(), ruleRow({ projectId: uuidv7(), name: 'Чужое' })]);
    const w = mount(RulesPage);
    await vi.waitFor(() => expect(w.findAll('[data-role=rule]')).toHaveLength(1));
    expect(w.text()).not.toContain('Чужое');
    await w.get('[data-role=rule] input[type=checkbox]').trigger('change');
    expect(mutate).toHaveBeenCalledWith('automations.update', {
      id: expect.any(String),
      enabled: false,
    });
  });

  it('wk3: конструктор — создаёт правило (триггер, условие, действие)', async () => {
    const w = mount(RulesPage);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Срок');
    await w.get('[data-role=trigger]').setValue('task.due');
    await w.get('[data-role=days-before]').setValue('2');
    await w.get('[data-role=add-condition]').trigger('click');
    await w.get('[data-role=value]').setValue('3, 4');
    await w.get('[data-role=action-type]').setValue('create_subtask');
    await w.get('[data-role=action-text]').setValue('Проверить');
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenCalledWith('automations.create', {
      id: 'new-id',
      projectId: P,
      name: 'Срок',
      enabled: true,
      trigger: { type: 'task.due', daysBefore: 2 },
      conditions: { op: 'and', rules: [{ field: 'priority', operator: 'in', value: ['3', '4'] }] },
      actions: [{ type: 'create_subtask', title: 'Проверить' }],
    });
  });

  it('wk3: неверное правило не уходит на сервер', async () => {
    const w = mount(RulesPage);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Без текста'); // add_comment с пустым text
    await w.get('[data-testid=editor]').trigger('submit');
    expect(w.find('[data-role=error]').exists()).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('wk3: журнал запусков — запрос REST и вывод ошибки запуска', async () => {
    const r = ruleRow();
    await h.db.table('automationsRules').put(r);
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: uuidv7(),
            ruleId: r.id,
            taskId: uuidv7(),
            depth: 1,
            status: 'error',
            error: 'сломалось',
            createdAt: T,
          },
          {
            id: uuidv7(),
            ruleId: r.id,
            taskId: uuidv7(),
            depth: 1,
            status: 'ok',
            error: null,
            createdAt: T,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(RulesPage);
    await vi.waitFor(() => expect(w.find('[data-role=runs]').exists()).toBe(true));
    await w.get('[data-role=runs]').trigger('click');
    await vi.waitFor(() => expect(w.findAll('[data-role=run]')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(`/api/automations/rules/${r.id}/runs?limit=50`, {
      credentials: 'include',
    });
    expect(w.text()).toContain('сломалось');
    vi.unstubAllGlobals();
  });

  it('wk3: fetchRuns — не-200 → ошибка', async () => {
    await expect(
      fetchRuns('x', (async () => new Response('', { status: 404 })) as never),
    ).rejects.toThrow('404');
  });
});

describe('wk3: условия', () => {
  it('wk3: смена поля сбрасывает оператор и значение; «пусто» без значения', async () => {
    const w = mount(ConditionsEditor, {
      props: {
        modelValue: {
          op: 'and',
          rules: [{ field: 'priority', operator: 'in', value: ['1'] }],
        } as never,
        'onUpdate:modelValue': (v: unknown) => w.setProps({ modelValue: v as never }),
      },
    });
    await w.get('[data-role=field]').setValue('assignee');
    expect(w.get('[data-role=operator]').element.querySelectorAll('option')).toHaveLength(4);
    await w.get('[data-role=operator]').setValue('isEmpty');
    expect(w.find('[data-role=value]').exists()).toBe(false);
  });
});
