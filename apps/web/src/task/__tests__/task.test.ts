import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { AssigneePicker, PriorityPicker, StatusPicker } from '../../tasks';
import Editor from '../editor/Editor.vue';
import ListRow from '../../views/list/Row.vue';
import { resetBreakpoint } from '../../ui';
import {
  db,
  eventually,
  flushPromises,
  ids,
  open,
  queued,
  setup,
  stubFetch,
  task,
  until,
} from './h';

let w: VueWrapper;
let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(() => {
  w?.unmount();
  vi.useRealTimers();
});

// subtasks and the checklist are tabs (PLNRAPP-100)
const openTab = async (name: string) => {
  await w
    .findAll('[role="tab"]')
    .find((b) => b.text().startsWith(name))!
    .trigger('click');
  await flushPromises();
};

const row = <T = Record<string, unknown>>(table: string, id: string) =>
  db.table(table).get(id) as Promise<T>;
const editorOf = (i = 0) => w.findAllComponents(Editor)[i];
const type = (i: number, text: string) => {
  const ed = editorOf(i).vm.editor!;
  ed.commands.insertContent(text);
  return ed;
};

const byText = (s: string) =>
  [...document.body.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find((e) =>
    e.textContent?.includes(s),
  );
const openMenu = async () => {
  w.find('[aria-label="Меню задачи"]').element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await flushPromises();
  await until(() => !!byText('В архив') || !!byText('Восстановить'));
};
const asSpaceAdmin = () =>
  db.table('spaceMembers').where('userId').equals(ids.ann).modify({ role: 'admin' });

describe('PLNRAPP-830: пустые поля под катом, меню «…» — контекстное меню задачи', () => {
  const col = (c: string) => w.find(`[data-testid=task-props] [data-col="${c}"]`).exists();
  it('пустые поля скрыты, кат раскрывает и сворачивает; заполненное поле видно', async () => {
    w = await open();
    expect(col('status')).toBe(true);
    for (const c of ['assignee', 'dates', 'priority', 'labels']) expect(col(c)).toBe(false);
    expect(w.find('[data-testid=watch]').exists()).toBe(true); // «Следить» — действие, строка всегда видна
    const toggle = () => w.get('[data-testid=empty-fields-toggle]');
    expect(toggle().text()).toBe('Пустые поля: 4');
    expect(toggle().attributes('aria-expanded')).toBe('false');
    await toggle().trigger('click');
    for (const c of ['assignee', 'dates', 'priority', 'labels']) expect(col(c)).toBe(true);
    expect(toggle().text()).toBe('Скрыть пустые поля');
    // the field filled at the open cut stays when the cut is closed
    w.findComponent(PriorityPicker).vm.$emit('update:modelValue', 2);
    await eventually(async () => (await row<{ priority: number }>('tasks', t.id)).priority === 2);
    await toggle().trigger('click');
    await until(() => col('priority'));
    expect(col('assignee')).toBe(false);
    expect(toggle().text()).toBe('Пустые поля: 3');
  });
  it('заполненные поля видны сразу, все заполнены — ката нет', async () => {
    await db.table('tasks').update(t.id, { priority: 1, dueDate: '2026-01-01' });
    const link = { spaceId: ids.space, taskId: t.id, createdAt: t.createdAt };
    await db.table('taskAssignees').put({ ...link, id: crypto.randomUUID(), userId: ids.ann });
    await db.table('taskLabels').put({ ...link, id: crypto.randomUUID(), labelId: ids.bug });
    w = await open();
    await until(() => col('assignee'));
    for (const c of ['dates', 'priority', 'labels']) expect(col(c)).toBe(true);
    expect(w.find('[data-testid=empty-fields-toggle]').exists()).toBe(false);
  });
  it('горячая клавиша на пустом поле открывает его из-под ката', async () => {
    w = await open();
    expect(col('priority')).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    await until(() => col('priority'));
  });
  it('меню «…» — те же пункты, что в контекстном меню задачи', async () => {
    const { useTaskMenu } = await import('../../tasks/taskMenu');
    const { mount } = await import('@vue/test-utils');
    const { defineComponent } = await import('vue');
    const { i18n } = await import('./h');
    const task = (await import('../../tasks/queries')).useTask;
    let labels: string[] = [];
    const probe = mount(
      defineComponent({
        setup() {
          const menuFor = useTaskMenu(ids.space);
          const tv = task(() => 'PLN-1');
          return () => {
            if (tv.value)
              labels = menuFor(tv.value).flatMap((it) => ('label' in it ? [it.label] : []));
            return null;
          };
        },
      }),
      { global: { plugins: [i18n] } },
    );
    await until(() => labels.length > 0);
    probe.unmount();
    w = await open();
    await until(() => w.find('[aria-label="Меню задачи"]').exists());
    await openMenu();
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(labels).toContain('Открыть');
    expect(
      items.map((e) =>
        [...labels].sort((x, y) => y.length - x.length).find((l) => e.textContent?.startsWith(l)),
      ),
    ).toEqual(labels);
  });
});

describe('task:archive (PLNRAPP-155)', () => {
  it('участник: «В архив» есть, «Удалить» нет; в архиве — плашка кто и когда, без «Восстановить»', async () => {
    w = await open();
    await until(() => w.find('[aria-label="Меню задачи"]').exists());
    await openMenu();
    expect(byText('Удалить')).toBeUndefined();
    byText('В архив')!.click();
    await eventually(async () => !!(await row<{ archivedAt: string }>('tasks', t.id)).archivedAt);
    expect(await row('tasks', t.id)).toMatchObject({ archivedBy: ids.ann });
    await until(() => w.find('[data-testid=archived-banner]').exists());
    expect(w.get('[data-testid=archived-banner]').text()).toContain('Ann');
    expect(w.find('[data-testid=archived-restore]').exists()).toBe(false);
  });

  it('админ пространства восстанавливает из плашки', async () => {
    await asSpaceAdmin();
    await db
      .table('tasks')
      .update(t.id, { archivedAt: new Date().toISOString(), archivedBy: ids.ann });
    w = await open();
    await until(() => w.find('[data-testid=archived-restore]').exists());
    await w.get('[data-testid=archived-restore]').trigger('click');
    await eventually(
      async () => (await row<{ archivedAt: null }>('tasks', t.id)).archivedAt === null,
    );
  });
});

describe('task:delete', () => {
  it('удаление (админ) — только после подтверждения', async () => {
    await asSpaceAdmin();
    w = await open();
    await until(() => w.find('[aria-label="Меню задачи"]').exists());
    const del = async () => {
      await openMenu();
      await until(() => !!byText('Удалить'));
      byText('Удалить')!.click();
      await until(() => !!document.body.querySelector('[role="dialog"]'));
    };
    await del();
    expect(await row('tasks', t.id)).toBeDefined(); // task.delete — hard deletion of the row
    byText('Отмена')!.click();
    await flushPromises();
    expect(await row('tasks', t.id)).toBeDefined(); // task.delete — hard deletion of the row
    await del();
    const dlg = document.body.querySelector('[role="dialog"]')!;
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Удалить')!.click();
    await eventually(async () => (await row('tasks', t.id)) === undefined);
  });
});

describe('task:favorite', () => {
  it('PLNRAPP-82 звезда в шапке добавляет задачу в избранное и убирает', async () => {
    const { favorites } = await import('../../layout/nav');
    w = await open();
    const star = () => w.get('[data-testid=task-favorite]');
    expect(star().attributes('aria-pressed')).toBe('false');
    await star().trigger('click');
    // PLNRAPP-124: the favourite is a replica row — it appears after favorite.add is applied
    await vi.waitFor(() => expect(star().attributes('aria-pressed')).toBe('true'));
    expect(favorites.has('task', t.id)).toBe(true);
    await star().trigger('click');
    await vi.waitFor(() => expect(favorites.has('task', t.id)).toBe(false));
  });
  it('PLNRAPP-65: ключ копирует ключ, кнопка рядом — ссылку; закрепление — только в боковой панели', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { taskOpenMode } = await import('../../views/open');
    const { taskPanelPinned } = await import('../../ui/taskPanelWidth');
    w = await open();
    expect(w.find('[data-testid=side-pin]').exists()).toBe(false);
    await w.get('[data-testid=copy-key]').trigger('click');
    expect(writeText).toHaveBeenLastCalledWith('PLN-1');
    await w.get('[data-testid=copy-link]').trigger('click');
    expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/t/PLN-1`);
    taskOpenMode.value = 'side';
    await flushPromises();
    const was = taskPanelPinned.value;
    await w.get('[data-testid=side-pin]').trigger('click');
    expect(taskPanelPinned.value).toBe(!was);
    taskOpenMode.value = 'modal';
  });
});

describe('task:fields', () => {
  it('смена статуса правит реплику', async () => {
    w = await open();
    w.findComponent(StatusPicker).vm.$emit('update:modelValue', ids.done);
    await eventually(
      async () => (await row<{ statusId: string }>('tasks', t.id)).statusId === ids.done,
    );
  });
  it('смена исполнителя и приоритета', async () => {
    w = await open();
    await w.get('[data-testid=empty-fields-toggle]').trigger('click');
    w.findComponent(AssigneePicker).vm.$emit('update:modelValue', [ids.ann]);
    w.findComponent(PriorityPicker).vm.$emit('update:modelValue', 2);
    await eventually(async () => (await row<{ priority: number }>('tasks', t.id)).priority === 2);
    await eventually(async () => (await db.table('taskAssignees').toArray()).length === 1);
  });
  it('заголовок: Enter сохраняет, пустой не сохраняется, Esc отменяет', async () => {
    w = await open();
    const input = w.find('header textarea');
    await input.setValue('Новый');
    await input.trigger('keydown', { key: 'Enter' });
    await eventually(async () => (await row<{ title: string }>('tasks', t.id)).title === 'Новый');
    await input.setValue('   ');
    await input.trigger('keydown', { key: 'Enter' });
    expect((await row<{ title: string }>('tasks', t.id)).title).toBe('Новый');
    await input.setValue('Другой');
    await input.trigger('keydown', { key: 'Escape' });
    expect((input.element as HTMLTextAreaElement).value).toBe('Новый');
    expect((await queued('task.update')).length).toBe(1);
    // a pasted line break is not kept in the title
    await input.setValue('Две\nстроки');
    await input.trigger('keydown', { key: 'Enter' });
    await eventually(
      async () => (await row<{ title: string }>('tasks', t.id)).title === 'Две строки',
    );
  });
});

describe('task:description', () => {
  it('описание — Collaboration task:<id>; редактор не пишет task.update, комментарии без collab', async () => {
    w = await open();
    expect(editorOf(0).props('collab')).toEqual({ name: `task:${t.id}` });
    expect(editorOf(1).props('collab')).toBeUndefined();
    // PLNRAPP-85: @@ / @@@ in the description, as in comments
    expect(editorOf(0).props('refs')).toBe(true);
    await until(() => !!editorOf(0).vm.editor);
    const n0 = (await queued('task.update')).length;
    type(0, 'привет');
    await new Promise((r) => setTimeout(r, 800));
    expect((await queued('task.update')).length).toBe(n0);
    expect((await row<{ description: unknown }>('tasks', t.id)).description).toBeNull();
  });
  it('PLNRAPP-144 выделенный текст → подзадача; выделение становится ссылкой на неё', async () => {
    w = await open();
    await until(() => !!editorOf(0).vm.editor);
    const ed = type(0, 'купить хлеб');
    // PLNRAPP-164: the menu goes below the selection end (on mobile the OS menu covers the space above)
    ed.view.coordsAtPos = (pos: number) => ({
      left: pos * 10,
      right: 0,
      top: pos,
      bottom: pos + 20,
    });
    ed.commands.setTextSelection({ from: 1, to: 7 });
    await until(() => w.find('[data-testid="selection-to-task"]').exists());
    const menu = w.find<HTMLElement>('[data-testid="selection-to-task"]').element;
    expect(menu.style.left).toBe('10px');
    expect(menu.style.top).toBe(`${7 + 20 + 16}px`);
    expect(menu.className).not.toContain('-translate-y-full');
    // PLNRAPP-215: the selection at the bottom edge (comment field on mobile) — the menu goes above it
    const h = window.innerHeight;
    ed.view.coordsAtPos = (pos: number) => ({
      left: pos * 10,
      right: 0,
      top: h - 40 + pos,
      bottom: h - 20 + pos,
    });
    ed.commands.setTextSelection({ from: 1, to: 6 });
    await until(
      () =>
        w.find<HTMLElement>('[data-testid="selection-to-task"]').element.style.bottom ===
        `${40 - 1 + 16}px`,
    );
    expect(menu.style.top).toBe('');
    ed.commands.setTextSelection({ from: 1, to: 7 });
    // PLNRAPP-684: not created at once — the creation dialog opens prefilled, a subtask of this task
    const { ui } = await import('../../command/hotkeys');
    await w
      .findAll('[data-testid="selection-to-task"] button')
      .find((b) => b.text() === 'Сделать подзадачей')!
      .trigger('click');
    expect(ui.create).toBe(true);
    expect(ui.createTitle).toBe('купить');
    expect(ui.createDescription).toBeNull();
    expect(ui.createDescriptionOpen).toBe(false);
    expect(ui.createParent).toEqual({ id: t.id, title: t.title, projectId: t.projectId });
    expect(ui.createProject).toBe(t.projectId);
    expect(w.find('[data-testid="selection-to-task"]').exists()).toBe(false);
    // the dialog created the task — the selection becomes a link to it
    ui.createDone!('sub-1');
    ui.create = false;
    await until(() => JSON.stringify(ed.getJSON()).includes('/t/sub-1'));
  });
  it('PLNRAPP-684 многострочное выделение → задача: имя — первая строка, полный текст — в развёрнутом описании', async () => {
    w = await open();
    await until(() => !!editorOf(0).vm.editor);
    const ed = editorOf(0).vm.editor!;
    ed.commands.setContent('<p><strong>купить</strong> хлеб</p><p>и молоко</p>');
    ed.view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });
    await until(() => w.find('[data-testid="selection-to-task"]').exists());
    const { ui } = await import('../../command/hotkeys');
    await w
      .findAll('[data-testid="selection-to-task"] button')
      .find((b) => b.text() !== 'Сделать подзадачей')!
      .trigger('click');
    expect(ui.create).toBe(true);
    expect(ui.createTitle).toBe('купить хлеб');
    expect(ui.createParent).toBeNull();
    expect(ui.createProject).toBe(t.projectId);
    expect(ui.createDescriptionOpen).toBe(true);
    expect(ui.createDescription).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'купить хлеб' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'и молоко' }] },
      ],
    });
    ui.create = false;
    ui.createDone = null;
  });
  it('картинка: uploadFile и узел image; 413 — сообщение', async () => {
    const f = stubFetch((m, p) =>
      m === 'POST' && p === '/files'
        ? [201, { sha256: 'ab'.repeat(32), size: 1, mime: 'image/png', width: 1, height: 1 }]
        : undefined,
    );
    w = await open();
    await until(() => !!editorOf(0).vm.editor);
    await editorOf(0).vm.insertFiles([new File(['x'], 'a.png', { type: 'image/png' })]);
    expect(f.mock.calls.some((c) => c[0] === '/files')).toBe(true);
    expect(JSON.stringify(editorOf(0).vm.editor!.getJSON())).toContain(
      `"src":"/files/${'ab'.repeat(32)}"`,
    );
    stubFetch(() => [413, { code: 'too_large', message: 'x' }]);
    await editorOf(0).vm.insertFiles([new File(['x'], 'b.png', { type: 'image/png' })]);
    await flushPromises();
    expect(w.text()).toContain('Файл больше допустимого размера');
  });
});

// PLNRAPP-865: the "View" settings of the project's List tab (the row the List writes, node p:<project>)
const listView = (config: Record<string, unknown>, id: string = crypto.randomUUID()) => ({
  id,
  spaceId: ids.space,
  userId: ids.ann,
  createdBy: ids.ann,
  name: 'list',
  layout: 'list',
  node: `p:${ids.project}`,
  filter: { op: 'and', rules: [] },
  config,
  rank: 'a1',
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
});

describe('task:subtasks', () => {
  // the tab's rows are the virtualized List (PLNRAPP-865): a viewport for the virtualizer, a wide area
  const sizes = ['clientHeight', 'clientWidth'] as const;
  const saved = sizes.map((k) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, k));
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 1600,
    });
  });
  afterEach(() => {
    sizes.forEach((k, i) =>
      saved[i]
        ? Object.defineProperty(HTMLElement.prototype, k, saved[i]!)
        : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k],
    );
  });
  it('список подзадач строкой «Списка» и создание с parentId', async () => {
    const child = task(2, { parentId: t.id, title: 'child' });
    await db.table('tasks').put(child);
    await db.table('taskAssignees').put({
      id: crypto.randomUUID(),
      taskId: child.id,
      userId: ids.ann,
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
    });
    w = await open();
    await until(() => w.find('[data-testid="tab-count-subtasks"]').text() === '0/1');
    expect(w.find('[data-testid="tab-count-checklist"]').exists()).toBe(false);
    await openTab('Подзадачи');
    // PLNRAPP-540: the List row component — status icon, key, title, assignee
    await until(() => w.text().includes('child') && w.text().includes('Todo'));
    const row = w.findComponent(ListRow);
    expect(row.exists()).toBe(true);
    expect(row.find('[data-testid="row-key"]').text()).toBe('PLN-2');
    expect(row.find('[data-testid="row-title"]').text()).toBe('child');
    expect(row.find('[data-col="status"]').exists()).toBe(true);
    await until(() => !!row.find('[data-col="assignee"] [title="Ann"]').exists());
    // PLNRAPP-828: the fields of the List view — priority and due date too
    expect(row.find('[data-col="dueDate"]').exists()).toBe(true);
    expect(row.find('[data-col="priority"]').exists()).toBe(true);
    // PLNRAPP-541: the List's «…» menu is in the subtask row too
    expect(row.find('[data-testid="row-menu"]').exists()).toBe(true);
    const input = w.find('input[placeholder="Добавить подзадачу"]');
    await input.setValue('второй');
    await input.trigger('submit');
    await w.find('form').trigger('submit');
    await eventually(async () =>
      (await db.table('tasks').toArray()).some((x) => x.title === 'второй' && x.parentId === t.id),
    );
  });
  // PLNRAPP-828: the status and assignee buttons right of the new subtask input
  it('новая подзадача создаётся с выбранными статусом и исполнителями', async () => {
    w = await open();
    await openTab('Подзадачи');
    await until(() => w.find('[data-testid="subtask-add"]').exists());
    const form = w.get('[data-testid="subtask-add"]');
    form.findComponent(StatusPicker).vm.$emit('update:modelValue', ids.done);
    form.findComponent(AssigneePicker).vm.$emit('update:modelValue', [ids.ann]);
    await flushPromises();
    await until(() => form.find('[title="Ann"]').exists());
    await form.get('input').setValue('с полями');
    await form.trigger('submit');
    const made = await until(async () =>
      (await db.table('tasks').toArray()).find((y) => y.title === 'с полями'),
    );
    expect(made.parentId).toBe(t.id);
    expect(made.statusId).toBe(ids.done);
    await eventually(async () =>
      (await db.table('taskAssignees').toArray()).some(
        (x) => x.taskId === made.id && x.userId === ids.ann,
      ),
    );
  });
  // PLNRAPP-541: the List's actions in the subtask rows
  describe('действия «Списка» (PLNRAPP-541)', () => {
    const kids = () => [
      task(2, { parentId: t.id, title: 'k1', rank: 'a1' }),
      task(3, { parentId: t.id, title: 'k2', rank: 'a2' }),
      task(4, { parentId: t.id, title: 'k3', rank: 'a3' }),
    ];
    const show = async () => {
      const ks = kids();
      await db.table('tasks').bulkPut(ks);
      w = await open();
      await openTab('Подзадачи');
      await until(() => w.findAllComponents(ListRow).length === 3);
      return ks;
    };
    const rowOf = (key: string) => w.get(`[data-testid="subtasks-list"] [data-task="${key}"]`);
    const order = async () =>
      (await db.table('tasks').where('parentId').equals(t.id).toArray())
        .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
        .map((x) => x.title);

    it('статус и исполнитель меняются из строки', async () => {
      const [k1] = await show();
      rowOf('PLN-2').findComponent(StatusPicker).vm.$emit('update:modelValue', ids.done);
      await eventually(
        async () => (await row<{ statusId: string }>('tasks', k1!.id)).statusId === ids.done,
      );
      await until(() => !w.find('[data-testid="subtasks-list"]').text().includes('k1'));
      await rowOf('PLN-3').trigger('pointerenter');
      await until(() => rowOf('PLN-3').findComponent(AssigneePicker).exists());
      rowOf('PLN-3').findComponent(AssigneePicker).vm.$emit('update:modelValue', [ids.ann]);
      await eventually(async () =>
        (await db.table('taskAssignees').toArray()).some((x) => x.userId === ids.ann),
      );
    });

    it('контекстное меню: «Выбрать» выделяет подзадачу, панель действий меняет статус', async () => {
      const [k1] = await show();
      await rowOf('PLN-2').trigger('contextmenu');
      const item = await until(() =>
        [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(
          (x) => x.textContent?.trim() === 'Выбрать',
        ),
      );
      item!.click();
      await until(() => rowOf('PLN-2').attributes('aria-selected') === 'true');
      await until(() => w.find('[data-testid="bulk-bar"]').exists());
      expect(w.get('[data-testid="bulk-bar"]').text()).toContain('Выбрано: 1');
      w.get('[data-testid="bulk-bar"]')
        .findComponent(StatusPicker)
        .vm.$emit('update:modelValue', ids.done);
      await eventually(
        async () => (await row<{ statusId: string }>('tasks', k1!.id)).statusId === ids.done,
      );
    });

    it('множественный выбор: Ctrl+клик, Shift+клик, чекбокс; выделение своё, не «Списка»', async () => {
      const { useSelection } = await import('../../views');
      useSelection().clear();
      await show();
      await rowOf('PLN-2').trigger('click', { ctrlKey: true });
      await rowOf('PLN-4').trigger('click', { shiftKey: true });
      await until(() => w.find('[data-testid="bulk-bar"]').exists());
      expect(w.get('[data-testid="bulk-bar"]').text()).toContain('Выбрано: 3');
      expect(useSelection().selected.value.size).toBe(0);
      await rowOf('PLN-3').get('[data-testid="row-check"]').trigger('change');
      await until(() => w.get('[data-testid="bulk-bar"]').text().includes('Выбрано: 2'));
      expect(rowOf('PLN-3').attributes('aria-selected')).toBe('false');
    });

    it('перетаскивание меняет порядок и сохраняет его', async () => {
      // the manual order without grouping: rows 32px one under another — k1, k2, k3
      await db.table('savedViews').put(listView({ groupBy: 'none', wrapTitles: false }));
      await show();
      document.elementFromPoint ??= () => null; // jsdom: no layout — nothing under the pointer
      // the list area at the top of the window, not near its edges (no auto-scroll)
      const grid = w.get('[data-testid="subtasks-list"] [role="grid"]').element as HTMLElement;
      grid.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 }) as DOMRect;
      const at = (type: string, clientY: number) =>
        Object.assign(new MouseEvent(type, { bubbles: true, clientY }), { pointerId: 1 });
      rowOf('PLN-4').get('[data-testid="row-grip"]').element.dispatchEvent(at('pointerdown', 80));
      await flushPromises();
      window.dispatchEvent(at('pointermove', 8)); // the upper half of k1 — before it
      await flushPromises();
      expect(w.find('[data-testid="drop-line"]').exists()).toBe(true);
      window.dispatchEvent(at('pointerup', 8));
      await eventually(async () => (await order()).join() === 'k3,k1,k2');
      await until(() => !w.find('[data-testid="drop-line"]').exists());
    });
  });
  // PLNRAPP-865: the "View" settings of the parent's project List apply to the tab, live
  it('настройки «Вид» списка проекта: скрытое свойство пропадает, группировка и плотность — как в «Списке»', async () => {
    await db
      .table('tasks')
      .bulkPut([
        task(2, { parentId: t.id, title: 'k1', rank: 'a1' }),
        task(3, { parentId: t.id, title: 'k2', rank: 'a2' }),
      ]);
    const view = listView({
      groupBy: 'none',
      showKey: false,
      fields: ['priority', 'assignee', 'status'],
    });
    await db.table('savedViews').put(view);
    w = await open();
    await openTab('Подзадачи');
    await until(() => w.findAllComponents(ListRow).length === 2);
    const row = () => w.get('[data-testid="subtasks-list"] [data-task="PLN-2"]');
    const cols = () =>
      row()
        .findAll('[data-col]')
        .map((c) => c.attributes('data-col'));
    // the List's column order (fixed, shared by the List's rows and header)
    expect(cols()).toEqual(['status', 'assignee', 'priority']);
    expect(row().find('[data-testid="row-key"]').exists()).toBe(false);
    expect(w.find('[data-testid="group-row"]').exists()).toBe(false);
    // the List hides «Assignees» and groups by status: the tab follows without reopening
    await db.table('savedViews').put({
      ...view,
      config: { ...view.config, groupBy: 'status', fields: ['priority', 'status'] },
      updatedAt: '2026-10-22T11:00:00.000Z',
    });
    await until(() => !cols().includes('assignee'));
    expect(cols()).toEqual(['status', 'priority']);
    await until(() => w.find('[data-testid="group-row"]').exists());
    expect(w.get('[data-testid="group-row"]').text()).toContain('Todo');
  });
  // PLNRAPP-542: done and cancelled subtasks are under the «Закрыто N» accordion, collapsed on opening
  it('аккордеон «Закрыто N»: свёрнут, клик раскрывает и сворачивает, при новом открытии свёрнут', async () => {
    const cancelled = crypto.randomUUID();
    await db.table('statuses').put({
      ...(await row('statuses', ids.done)),
      id: cancelled,
      name: 'Cancelled',
      category: 'cancelled',
      rank: 'a3',
    });
    await db
      .table('tasks')
      .bulkPut([
        task(2, { parentId: t.id, title: 'open child' }),
        task(3, { parentId: t.id, title: 'done child', statusId: ids.done }),
        task(4, { parentId: t.id, title: 'cancelled child', statusId: cancelled }),
      ]);
    w = await open();
    await openTab('Подзадачи');
    await until(() => w.text().includes('open child'));
    const acc = () => w.find('[data-testid="subtasks-closed"]');
    expect(acc().text()).toBe('Закрыто 2');
    expect(acc().attributes('aria-expanded')).toBe('false');
    expect(w.text()).not.toContain('done child');
    expect(w.text()).not.toContain('cancelled child');
    await acc().trigger('click');
    expect(acc().attributes('aria-expanded')).toBe('true');
    // the closed ones join the list's rows (PLNRAPP-865: in the groups of the List's settings)
    await until(() => w.find('[data-testid="subtasks-list"]').text().includes('done child'));
    expect(w.find('[data-testid="subtasks-list"]').text()).toContain('cancelled child');
    await acc().trigger('click');
    expect(w.text()).not.toContain('done child');
    await acc().trigger('click');
    w.unmount();
    w = await open();
    await openTab('Подзадачи');
    await until(() => acc().exists());
    expect(acc().attributes('aria-expanded')).toBe('false');
    expect(w.text()).not.toContain('done child');
  });

  it('без закрытых подзадач аккордеона нет', async () => {
    await db.table('tasks').put(task(2, { parentId: t.id, title: 'child' }));
    w = await open();
    await openTab('Подзадачи');
    await until(() => w.text().includes('child'));
    expect(w.find('[data-testid="subtasks-closed"]').exists()).toBe(false);
  });

  it('клик по подзадаче без роутера не падает', async () => {
    await db.table('tasks').put(task(2, { parentId: t.id, title: 'child' }));
    w = await open();
    await openTab('Подзадачи');
    await until(() => w.text().includes('child'));
    await w.find('[data-task="PLN-2"]').trigger('click');
  });
});

// the item's «…» menu (PLNRAPP-142): open and choose an action
const itemAction = async (label: string, index = 0) => {
  w.findAll('button[aria-label="Действия с пунктом"]')[index]!.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await flushPromises();
  const item = () =>
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) =>
      e.textContent?.includes(label),
    );
  await until(() => !!item());
  item()!.click();
  await flushPromises();
};

describe('task:checklist', () => {
  it('добавить, отметить, удалить', async () => {
    w = await open();
    await openTab('Чек-лист');
    const section = () => w.find('section[aria-label="Чек-лист"]');
    await section().find('input[type=text], input:not([type])').setValue('пункт');
    await section().find('form').trigger('submit');
    await eventually(async () => (await db.table('checklistItems').toArray()).length === 1);
    await until(() => section().find('input[type=checkbox]').exists());
    await section().find('input[type=checkbox]').setValue(true);
    await eventually(async () => (await db.table('checklistItems').toArray())[0].done === true);
    await itemAction('Удалить');
    await eventually(async () => (await db.table('checklistItems').toArray()).length === 0);
  });
  it('PLNRAPP-142 «…» → «Сделать подзадачей»: подзадача создана, текст пункта — ссылка на неё', async () => {
    w = await open();
    await openTab('Чек-лист');
    const section = () => w.find('section[aria-label="Чек-лист"]');
    await section().find('input[type=text], input:not([type])').setValue('купить');
    await section().find('form').trigger('submit');
    await until(() => section().find('[data-testid="checklist-item"]').exists());
    await itemAction('Сделать подзадачей');
    await eventually(async () => !!(await db.table('checklistItems').toArray())[0]?.linkedTaskId);
    const [item] = await db.table('checklistItems').toArray();
    expect(await row('tasks', item.linkedTaskId)).toMatchObject({
      title: 'купить',
      parentId: t.id,
    });
    await until(() => section().find('[data-testid="checklist-link"]').exists());
    expect(section().find('[data-testid="checklist-link"]').text()).toBe('купить');
  });
  it('PLNRAPP-143 вложенность: уровень не глубже предыдущего + 1; Tab в поле, «Вынести» в меню', async () => {
    const mk = (indent: number, rank: string) => ({
      id: crypto.randomUUID(),
      spaceId: ids.space,
      taskId: t.id,
      text: rank,
      done: false,
      rank,
      indent,
      createdAt: t.createdAt,
      updatedAt: t.createdAt,
    });
    const b = mk(3, 'a2');
    await db.table('checklistItems').bulkPut([mk(0, 'a1'), b]);
    w = await open();
    await openTab('Чек-лист');
    const levels = () =>
      w.findAll('[data-testid="checklist-item"]').map((x) => x.attributes('data-level'));
    await until(() => levels().length === 2);
    expect(levels()).toEqual(['0', '1']); // indent 3 after a top item — shown as 1
    const form = w.find('[data-testid="checklist-add"]');
    await form.find('input').setValue('новый');
    for (let k = 0; k < 3; k++) await form.trigger('keydown', { key: 'Tab' });
    await form.trigger('submit');
    await eventually(async () => (await db.table('checklistItems').count()) === 3);
    const added = (await db.table('checklistItems').toArray()).find((x) => x.text === 'новый');
    expect(added.indent).toBe(2); // at most the last item's level + 1
    await itemAction('Вынести на уровень выше', 1);
    await eventually(
      async () => (await row<{ indent: number }>('checklistItems', b.id)).indent === 0,
    );
  });
  it('прогресс done/total', async () => {
    const mk = (done: boolean, rank: string) => ({
      id: crypto.randomUUID(),
      spaceId: ids.space,
      taskId: t.id,
      text: rank,
      done,
      rank,
      createdAt: t.createdAt,
      updatedAt: t.createdAt,
    });
    await db.table('checklistItems').bulkPut([mk(true, 'a1'), mk(false, 'a2')]);
    w = await open();
    await until(() => w.find('[data-testid="tab-count-checklist"]').text() === '1/2');
  });
  it('пустой пункт не создаётся', async () => {
    w = await open();
    await openTab('Чек-лист');
    await w.find('section[aria-label="Чек-лист"] form').trigger('submit');
    await flushPromises();
    expect(await queued('checklist.add')).toHaveLength(0);
  });
});

// PLNRAPP-866: on mobile the subtasks are the mobile List's rows, edge to edge as the List
describe('мобильная раскладка таба «Подзадачи» (PLNRAPP-866)', () => {
  // jsdom has no layout: the virtualizer gets the scroller height, as in the List tests
  const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')!;
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    resetBreakpoint();
  });
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch);
    vi.unstubAllGlobals();
    resetBreakpoint();
  });
  it('строки — мобильные карточки «Списка» на всю ширину экрана, без «…»', async () => {
    await db
      .table('tasks')
      .bulkPut([
        task(2, { parentId: t.id, title: 'x'.repeat(200), rank: 'a1' }),
        task(3, { parentId: t.id, title: 'k2', rank: 'a2' }),
      ]);
    w = await open();
    await openTab('Подзадачи');
    await until(() => w.findAllComponents(ListRow).length === 2);
    const list = w.get('[data-testid="subtasks-list"]');
    // the card column's padding (px-4, @2xl:px-8) is compensated: the row width is the screen's
    const column = list.element.closest('.px-4')!;
    expect(column.classList.contains('@2xl:px-8')).toBe(true);
    expect(list.classes()).toEqual(expect.arrayContaining(['max-md:-mx-4', 'max-md:@2xl:-mx-8']));
    // the mobile row of the List: the card layout, the menu by a long press — no «…» button
    const row = list.get('[data-task="PLN-2"]');
    expect(row.classes()).toEqual(expect.arrayContaining(['pl-2', 'pr-3', 'py-1']));
    expect(list.find('[data-testid="row-menu"]').exists()).toBe(false);
    expect(list.find('[data-testid="list-head"]').exists()).toBe(false);
    // a long name does not widen the row: the name column may shrink
    expect(row.get('.min-w-0.flex-1').text()).toContain('x'.repeat(200));
  });
});
