import 'fake-indexeddb/auto';
import { mount as vmount } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { i18n } from '../../../i18n';
import Select from '../../../ui/Select.vue';
import { defineComponent, h as vh, ref } from 'vue';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import type { PlanarDB } from '../../../sync/db';
import RulesPage from '../../../../../../modules/automations/web/RulesPage.vue';
import { fetchRuns } from '../../../../../../modules/automations/web/data';
import * as shared from '../../../../../../modules/automations/shared/index';

const mutate = vi.hoisted(() => vi.fn(async () => {}));
const h = vi.hoisted(() => ({ db: undefined as unknown as PlanarDB }));
vi.mock('../../../sync', async () => {
  const { PlanarDB } = await import('../../../sync/db');
  const { useQuery } = await import('../../../sync/query');
  h.db = new PlanarDB('wk3', {
    automationsRules: ['spaceId', 'projectId'],
    aiActions: ['spaceId', 'projectId'],
  });
  return {
    db: h.db,
    mutate,
    registerMutators: vi.fn(),
    useQuery,
    newId: () => 'new-id',
    replicaState: { value: 'empty' }, // layout/nav (favourites, PLNRAPP-124)
  };
});
const SP = uuidv7();
const P = uuidv7();
const S1 = uuidv7();
// pickers pull in popovers of the core: a stub shows the value in data-value, set by an event
vi.mock('../../../tasks', async () => {
  const { defineComponent: dc, h: hh } = await import('vue');
  const picker = (name: string) =>
    dc({
      name,
      props: ['modelValue'],
      emits: ['update:modelValue'],
      setup: (p) => () => hh('span', { 'data-value': (p.modelValue ?? []).join(',') }),
    });
  return {
    StatusesPicker: picker('StatusesPicker'),
    AssigneePicker: picker('AssigneePicker'),
    useSpaces: () => ref([{ id: SP, projects: [{ id: P, spaceId: SP, name: 'Проект' }] }]),
    useStatuses: () => ref([{ id: S1, name: 'В работе', category: 'in_progress' }]),
    useMembers: () => ref([]),
    useLabels: () => ref([]),
  };
});

// the real FilterBuilder pulls in the whole core; here we only check the wiring with the builder
const FB = defineComponent({
  name: 'FilterBuilder',
  props: ['modelValue', 'projectId'],
  emits: ['update:modelValue'],
  setup:
    (p, { emit }) =>
    () =>
      vh(
        'button',
        {
          'data-role': 'add-condition',
          'data-project': p.projectId,
          type: 'button',
          onClick: () =>
            emit('update:modelValue', {
              ...p.modelValue,
              rules: [{ field: 'cycle', operator: 'in', value: ['current'] }],
            }),
        },
        'fb',
      ),
});
const stubs = { global: { stubs: { FilterBuilder: FB } } };
// IconButton/Menu require TooltipProvider (App.vue provides it) and i18n
const mount = (c: object, o: { global?: object } = {}) =>
  vmount(defineComponent({ render: () => vh(TooltipProvider, () => vh(c)) }), {
    global: { plugins: [i18n], ...o.global },
  } as never);
// Select (Reka) doesn't expand in jsdom: value selection is a component event
const pick = async (w: ReturnType<typeof mount>, role: string, v: string) => {
  w.get(`[data-role=${role}]`).getComponent(Select).vm.$emit('update:modelValue', v);
  await w.vm.$nextTick();
};

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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('wk3: схемы', () => {
  it('wk3: trigger/action/filter — верные принимаются, send_webhook и мусор', () => {
    const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
      s.safeParse(v).success;
    expect(ok(shared.triggerSchema, { type: 'task.due', daysBefore: 30 })).toBe(true);
    expect(ok(shared.triggerSchema, { type: 'task.due', daysBefore: 31 })).toBe(false);
    expect(ok(shared.triggerSchema, { type: 'x' })).toBe(false);
    expect(ok(shared.actionSchema, { type: 'set_field', field: 'dueDate', value: 'today+2' })).toBe(
      true,
    );
    expect(ok(shared.actionSchema, { type: 'set_field', field: 'priority', value: 7 })).toBe(false);
    expect(ok(shared.actionSchema, { type: 'send_webhook', subscriptionId: uuidv7() })).toBe(true);
    expect(ok(shared.actionSchema, { type: 'send_webhook', subscriptionId: 'x' })).toBe(false);
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
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Срок');
    await pick(w, 'trigger', 'task.due');
    await w.get('[data-role=days-before]').setValue('2');
    await w.get('[data-role=add-condition]').trigger('click');
    await pick(w, 'action-type', 'create_subtask');
    await w.get('[data-role=action-text]').setValue('Проверить');
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenCalledWith('automations.create', {
      id: 'new-id',
      projectId: P,
      name: 'Срок',
      description: null,
      enabled: true,
      trigger: { type: 'task.due', daysBefore: 2 },
      conditions: { op: 'and', rules: [{ field: 'cycle', operator: 'in', value: ['current'] }] },
      actions: [{ type: 'create_subtask', title: 'Проверить' }],
    });
  });

  it('PLNRAPP-166: конструктор — schedule с поясом, описание', async () => {
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Сводка');
    await w.get('[data-role=description]').setValue('По понедельникам');
    await pick(w, 'trigger', 'schedule');
    await w.get('[data-role=cron]').setValue('0 10 * * 1');
    await w.get('[data-role=tz]').setValue('Europe/Moscow');
    await w.get('[data-role=action-text]').setValue('Неделя');
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenCalledWith(
      'automations.create',
      expect.objectContaining({
        description: 'По понедельникам',
        trigger: { type: 'schedule', cron: '0 10 * * 1', tz: 'Europe/Moscow' },
      }),
    );
  });

  it('PLNRAPP-166: конструктор — stale (дни), comment.added только от людей', async () => {
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Тишина');
    await pick(w, 'trigger', 'task.stale');
    await w.get('[data-role=trigger-num]').setValue('5');
    await w.get('[data-role=action-text]').setValue('Пинг');
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenLastCalledWith(
      'automations.create',
      expect.objectContaining({ trigger: { type: 'task.stale', days: 5 } }),
    );
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Ответ');
    await pick(w, 'trigger', 'comment.added');
    await w.get('[data-role=by-human]').setValue(true);
    await w.get('[data-role=action-text]').setValue('Спасибо');
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenLastCalledWith(
      'automations.create',
      expect.objectContaining({ trigger: { type: 'comment.added', byHuman: true } }),
    );
  });

  it('PLNRAPP-197: статусы и пользователи триггеров — мультивыбор', async () => {
    const [S2, U1, U2] = [uuidv7(), uuidv7(), uuidv7()];
    // the k-th picker of the editor emits a value
    const set = async (w: ReturnType<typeof mount>, name: string, k: number, v: string[]) => {
      w.findAllComponents({ name }).at(k)!.vm.$emit('update:modelValue', v);
      await w.vm.$nextTick();
    };
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Статусы');
    await pick(w, 'trigger', 'task.status_changed');
    await set(w, 'StatusesPicker', 0, [S1]);
    await set(w, 'StatusesPicker', 1, [S1, S2]);
    await w.get('[data-role=action-text]').setValue('Пинг');
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenLastCalledWith(
      'automations.create',
      expect.objectContaining({
        trigger: { type: 'task.status_changed', from: [S1], to: [S1, S2] },
      }),
    );
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Исполнители');
    await pick(w, 'trigger', 'task.assignee_changed');
    await set(w, 'AssigneePicker', 0, [U1, U2]);
    await w.get('[data-role=action-text]').setValue('Пинг');
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenLastCalledWith(
      'automations.create',
      expect.objectContaining({ trigger: { type: 'task.assignee_changed', userIds: [U1, U2] } }),
    );
  });

  it('PLNRAPP-197: старые правила открываются в пикерах', async () => {
    const U1 = uuidv7();
    const S2 = uuidv7();
    await h.db
      .table('automationsRules')
      .bulkPut([
        ruleRow({ trigger: { type: 'task.assignee_changed', userId: U1 } }),
        ruleRow({ name: 'Статусы', trigger: { type: 'task.status_changed', to: [S1, S2] } }),
      ]);
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.findAll('[data-role=edit]')).toHaveLength(2));
    await w.findAll('[data-role=edit]')[0]!.trigger('click');
    expect(w.get('[data-role=users] [data-value]').attributes('data-value')).toBe(U1);
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenLastCalledWith(
      'automations.update',
      expect.objectContaining({ trigger: { type: 'task.assignee_changed', userId: U1 } }),
    );
    await vi.waitFor(() => expect(w.findAll('[data-role=edit]')).toHaveLength(2));
    await w.findAll('[data-role=edit]')[1]!.trigger('click');
    expect(w.get('[data-role=to] [data-value]').attributes('data-value')).toBe(`${S1},${S2}`);
  });

  it('PLNRAPP-166: описание правила в списке', async () => {
    await h.db.table('automationsRules').bulkPut([ruleRow({ description: 'Зачем это' })]);
    const w = mount(RulesPage);
    await vi.waitFor(() => expect(w.find('[data-role=desc]').text()).toBe('Зачем это'));
  });

  it('wk3: неверное правило не уходит на сервер', async () => {
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Без текста'); // add_comment with empty text
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

describe('wk3b: конструктор', () => {
  it('wk3b: условия — FilterBuilder SDK с проектом правила', async () => {
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    expect(w.findComponent(FB).props('projectId')).toBe(P);
    await w.get('[data-role=add-condition]').trigger('click');
    expect(w.findComponent(FB).props('modelValue')).toMatchObject({
      rules: [{ field: 'cycle', value: ['current'] }],
    });
  });

  it('wk3b: действие send_webhook — создаётся с subscriptionId', async () => {
    const sub = uuidv7();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: sub, url: 'http://x/hook', description: 'Хук' }] }),
      })),
    );
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('Хук');
    await pick(w, 'action-type', 'send_webhook');
    await vi.waitFor(() =>
      expect(w.get('[data-role=action-param]').getComponent(Select).props('options')).toEqual([
        { value: sub, label: 'Хук — http://x/hook' },
      ]),
    );
    await pick(w, 'action-param', sub);
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenCalledWith(
      'automations.create',
      expect.objectContaining({ actions: [{ type: 'send_webhook', subscriptionId: sub }] }),
    );
  });

  it('PLNRAPP-168: действие ai_run — выбор ИИ-действия проекта', async () => {
    const a = uuidv7();
    await h.db.table('aiActions').bulkPut([
      { id: a, spaceId: SP, projectId: P, name: 'Планирование' },
      { id: uuidv7(), spaceId: SP, projectId: uuidv7(), name: 'Чужое' },
    ]);
    const w = mount(RulesPage, stubs);
    await vi.waitFor(() => expect(w.find('[data-role=new]').exists()).toBe(true));
    await w.get('[data-role=new]').trigger('click');
    await w.get('[data-role=name]').setValue('ИИ');
    await pick(w, 'action-type', 'ai_run');
    await vi.waitFor(() =>
      expect(w.get('[data-role=action-param]').getComponent(Select).props('options')).toEqual([
        { value: a, label: 'Планирование' },
      ]),
    );
    await pick(w, 'action-param', a);
    await w.get('[data-testid=editor]').trigger('submit');
    expect(mutate).toHaveBeenCalledWith(
      'automations.create',
      expect.objectContaining({ actions: [{ type: 'ai_run', aiActionId: a }] }),
    );
  });
});
