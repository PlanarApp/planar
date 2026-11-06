import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { AssigneePicker, PriorityPicker, StatusPicker } from '../../tasks';
import Editor from '../editor/Editor.vue';
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

const row = <T = Record<string, unknown>>(table: string, id: string) =>
  db.table(table).get(id) as Promise<T>;
const editorOf = (i = 0) => w.findAllComponents(Editor)[i];
const type = (i: number, text: string) => {
  const ed = editorOf(i).vm.editor!;
  ed.commands.insertContent(text);
  return ed;
};

describe('task:delete', () => {
  it('удаление — только после подтверждения', async () => {
    w = await open();
    await until(() => w.find('[aria-label="Меню задачи"]').exists());
    const byText = (s: string) =>
      [...document.body.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find((e) =>
        e.textContent?.includes(s),
      );
    const del = async () => {
      w.find('[aria-label="Меню задачи"]').element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await flushPromises();
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
    expect(favorites.has('task', t.id)).toBe(true);
    expect(star().attributes('aria-pressed')).toBe('true');
    await star().trigger('click');
    expect(favorites.has('task', t.id)).toBe(false);
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

describe('task:subtasks', () => {
  it('список подзадач и создание с parentId', async () => {
    await db.table('tasks').put(task(2, { parentId: t.id, title: 'child' }));
    w = await open();
    await until(() => w.text().includes('child') && w.text().includes('Todo'));
    expect(w.text()).toContain('PLN-2');
    const input = w.find('input[placeholder="Добавить подзадачу"]');
    await input.setValue('второй');
    await input.trigger('submit');
    await w.find('form').trigger('submit');
    await eventually(async () =>
      (await db.table('tasks').toArray()).some((x) => x.title === 'второй' && x.parentId === t.id),
    );
  });
  it('клик по подзадаче без роутера не падает', async () => {
    await db.table('tasks').put(task(2, { parentId: t.id, title: 'child' }));
    w = await open();
    await until(() => w.text().includes('child'));
    await w
      .findAll('section button')
      .find((b) => b.text().includes('child'))!
      .trigger('click');
  });
});

describe('task:checklist', () => {
  it('добавить, отметить, удалить', async () => {
    w = await open();
    const section = () => w.find('section[aria-label="Чек-лист"]');
    await section().find('input[type=text], input:not([type])').setValue('пункт');
    await section().find('form').trigger('submit');
    await eventually(async () => (await db.table('checklistItems').toArray()).length === 1);
    await until(() => section().find('input[type=checkbox]').exists());
    await section().find('input[type=checkbox]').setValue(true);
    await eventually(async () => (await db.table('checklistItems').toArray())[0].done === true);
    await section().find('button').trigger('click');
    await eventually(async () => (await db.table('checklistItems').toArray()).length === 0);
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
    await until(() => w.text().includes('1/2'));
  });
  it('пустой пункт не создаётся', async () => {
    w = await open();
    await w.find('section[aria-label="Чек-лист"] form').trigger('submit');
    await flushPromises();
    expect(await queued('checklist.add')).toHaveLength(0);
  });
});
