import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { registerModules } from '../../modules/registry';
import Editor from '../editor/Editor.vue';
import { db, eventually, flushPromises, ids, open, queued, setup, stubFetch, until } from './h';

let w: VueWrapper;
let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(() => w?.unmount());

const T0 = Date.parse('2026-10-22T10:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const comment = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  spaceId: ids.space,
  taskId: t.id,
  authorId: ids.ann,
  body: doc('привет'),
  mentions: [],
  editedAt: null,
  createdAt: at(1),
  updatedAt: at(1),
  ...over,
});
const composer = () =>
  w.findAllComponents(Editor).find((e) => e.props('label').startsWith('Написать'))!;
const comments = () => db.table('comments').toArray();
const ACT = (rows: unknown[]) => (m: string, p: string) =>
  m === 'GET' && p === `/api/tasks/${t.id}/activity`
    ? ([200, { rows }] as [number, unknown])
    : undefined;

describe('task:comments', () => {
  it('создание с упоминанием заполняет mentions', async () => {
    w = await open();
    const ed = composer().vm.editor!;
    ed.commands.insertContent([
      { type: 'text', text: 'эй ' },
      { type: 'mention', attrs: { id: ids.ann, label: 'Ann' } },
    ]);
    await flushPromises();
    await w.find('[data-testid="comment-send"]').trigger('click');
    await eventually(async () => (await comments()).length === 1);
    expect((await comments())[0].mentions).toEqual([ids.ann]);
    expect((await comments())[0].authorId).toBe(ids.ann);
  });
  it('правка своего комментария ставит editedAt', async () => {
    await db.table('comments').put(comment());
    w = await open();
    await until(() => w.find('[data-testid="comment-edit"]').exists());
    await w.find('[data-testid="comment-edit"]').trigger('click');
    await flushPromises();
    const ed = w
      .findAllComponents(Editor)
      .find(
        (e) =>
          e.props('editable') !== false &&
          !e.props('placeholder') &&
          e.props('label') === 'Комментарий',
      )!;
    ed.vm.editor!.commands.setContent(doc('исправлено'));
    await flushPromises();
    const save = w.findAll('button').find((b) => b.text() === 'Сохранить')!;
    await save.trigger('click');
    await eventually(async () => (await comments())[0].editedAt);
    expect(JSON.stringify((await comments())[0].body)).toContain('исправлено');
  });
  it('чужой комментарий не редактируется и не удаляется', async () => {
    await db.table('comments').put(comment({ authorId: ids.bob }));
    w = await open();
    await until(() => w.find('[data-testid="comment"]').exists());
    expect(w.find('[data-testid="comment-edit"]').exists()).toBe(false);
    expect(w.find('[data-testid="comment-delete"]').exists()).toBe(false);
  });
  it('Cmd+Enter отправляет, пустой не отправляется', async () => {
    w = await open();
    const ed = composer().vm.editor!;
    const press = () =>
      ed.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      );
    press();
    await flushPromises();
    expect(await queued('comment.create')).toHaveLength(0);
    ed.commands.insertContent('текст');
    await flushPromises();
    press();
    await eventually(async () => (await comments()).length === 1);
    expect(ed.isEmpty).toBe(true);
  });
  it('удаление своего комментария', async () => {
    await db.table('comments').put(comment());
    w = await open();
    await until(() => w.find('[data-testid="comment-delete"]').exists());
    await w.find('[data-testid="comment-delete"]').trigger('click');
    await eventually(async () => (await comments()).length === 0);
  });
});

describe('task:feed', () => {
  it('комментарии и активность сливаются по времени', async () => {
    await db.table('comments').put(comment({ createdAt: at(20), body: doc('СРЕДНИЙ') }));
    stubFetch(
      ACT([
        {
          id: crypto.randomUUID(),
          spaceId: ids.space,
          taskId: t.id,
          actorId: ids.ann,
          kind: 'created',
          changes: {},
          createdAt: at(10),
        },
        {
          id: crypto.randomUUID(),
          spaceId: ids.space,
          taskId: t.id,
          actorId: ids.ann,
          kind: 'updated',
          changes: { statusId: ['a', 'b'] },
          createdAt: at(30),
        },
        {
          id: crypto.randomUUID(),
          spaceId: ids.space,
          taskId: t.id,
          actorId: ids.ann,
          kind: 'commented',
          changes: {},
          createdAt: at(21),
        },
      ]),
    );
    w = await open();
    await until(
      () => w.findAll('[data-testid="activity"]').length === 2 && w.text().includes('СРЕДНИЙ'),
    );
    const order = [
      ...w.element.querySelectorAll('[data-testid="activity"], [data-testid="comment"]'),
    ].map((e) => e.textContent ?? '');
    expect(order).toHaveLength(3);
    expect(order[0]).toContain('создал');
    expect(order[1]).toContain('СРЕДНИЙ');
    expect(order[2]).toContain('изменил(а): статус');
  });
  it('офлайн: только комментарии, без ошибки', async () => {
    await db.table('comments').put(comment({ body: doc('ЛОКАЛЬНЫЙ') }));
    stubFetch(() => undefined); // 500
    w = await open();
    await until(() => w.text().includes('ЛОКАЛЬНЫЙ'));
    await flushPromises();
    expect(w.findAll('[data-testid="activity"]')).toHaveLength(0);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });
});

describe('task:attachments', () => {
  // jsdom doesn't compute coordinates — call the editor's drop handler directly
  const dropOnEditor = (...files: File[]) => {
    const view = w.findAllComponents(Editor)[0].vm.editor!.view;
    const ev = { dataTransfer: { files }, preventDefault() {} } as unknown as DragEvent;
    view.someProp('handleDrop', (f) => f(view, ev, null as never, false));
  };
  const up = { sha256: 'cd'.repeat(32), size: 3, mime: 'image/png', width: 2, height: 2 };
  const upload = (m: string, p: string) =>
    m === 'POST' && p === '/files' ? ([201, up] as [number, unknown]) : undefined;
  it('кнопка: загрузка и attachment.create, ссылка и превью', async () => {
    stubFetch(upload);
    w = await open();
    const input = w.find('[data-testid="file-input"]');
    Object.defineProperty(input.element, 'files', {
      value: [new File(['abc'], 'a b.png', { type: 'image/png' })],
    });
    await input.trigger('change');
    await eventually(async () => (await db.table('attachments').toArray()).length === 1);
    const a = (await db.table('attachments').toArray())[0];
    expect(a).toMatchObject({
      fileSha256: up.sha256,
      name: 'a b.png',
      mime: 'image/png',
      size: 3,
      width: 2,
      height: 2,
      taskId: t.id,
    });
    await until(() => w.find(`a[href="/files/${up.sha256}?name=a%20b.png"]`).exists());
    expect(w.find(`img[src="/files/${up.sha256}/preview?w=256"]`).exists()).toBe(true);
  });
  it('drop картинки в редактор: узел image, один uploadFile, без вложения', async () => {
    const f = stubFetch(upload);
    w = await open();
    dropOnEditor(new File(['a'], 'c.png', { type: 'image/png' }));
    await eventually(async () =>
      JSON.stringify(w.findAllComponents(Editor)[0].vm.editor!.getJSON()).includes(up.sha256),
    );
    expect(f.mock.calls.filter((c) => c[0] === '/files')).toHaveLength(1);
    expect(await queued('attachment.create')).toHaveLength(0);
  });
  it('drop не-картинки в редактор: вложение задачи', async () => {
    stubFetch(upload);
    w = await open();
    dropOnEditor(new File(['a'], 'c.txt', { type: 'text/plain' }));
    await eventually(async () => (await db.table('attachments').toArray()).length === 1);
    expect((await db.table('attachments').toArray())[0]).toMatchObject({ name: 'c.txt' });
  });
  it('drop картинки и файла вместе: и image, и вложение', async () => {
    stubFetch(upload);
    w = await open();
    dropOnEditor(
      new File(['a'], 'c.png', { type: 'image/png' }),
      new File(['a'], 'c.txt', { type: 'text/plain' }),
    );
    await eventually(async () => (await db.table('attachments').toArray()).length === 1);
    await eventually(async () =>
      JSON.stringify(w.findAllComponents(Editor)[0].vm.editor!.getJSON()).includes(up.sha256),
    );
    expect(await db.table('attachments').count()).toBe(1);
  });
  it('перетаскивание файла на панель; 413 — сообщение', async () => {
    stubFetch(upload);
    w = await open();
    const file = new File(['abc'], 'b.txt', { type: 'text/plain' });
    await w.find('article').trigger('drop', { dataTransfer: { files: [file] } });
    await eventually(async () => (await db.table('attachments').toArray()).length === 1);
    stubFetch(() => [413, { code: 'too_large', message: 'x' }]);
    await w.find('article').trigger('drop', { dataTransfer: { files: [file] } });
    await until(() => w.text().includes('Файл больше допустимого размера'));
    expect(await db.table('attachments').count()).toBe(1);
  });
});

describe('task:watch', () => {
  it('следить создаёт taskWatchers для себя', async () => {
    w = await open();
    await w.find('[data-testid="watch"]').trigger('click');
    await eventually(async () => (await db.table('taskWatchers').toArray()).length === 1);
    expect((await db.table('taskWatchers').toArray())[0]).toMatchObject({
      userId: ids.ann,
      taskId: t.id,
    });
    await until(() => w.find('[data-testid="watch"]').text() === 'Не следить');
  });
  it('не следить удаляет строку', async () => {
    await db.table('taskWatchers').put({
      id: crypto.randomUUID(),
      spaceId: ids.space,
      taskId: t.id,
      userId: ids.ann,
      createdAt: t.createdAt,
    });
    w = await open();
    await until(() => w.find('[data-testid="watch"]').text() === 'Не следить');
    await w.find('[data-testid="watch"]').trigger('click');
    await eventually(async () => (await db.table('taskWatchers').count()) === 0);
  });
});

describe('task:extensions', () => {
  it('вкладка модуля монтирует компонент с taskId', async () => {
    const Panel = defineComponent({
      props: { taskId: String },
      setup: (p) => () => h('p', { 'data-testid': 'ext' }, `ext:${p.taskId}`),
    });
    registerModules([
      {
        id: 'demo',
        taskPanels: [
          {
            id: 'p',
            label: { ru: 'Демо', en: 'Demo' },
            component: async () => ({ default: Panel }),
          },
        ],
      },
    ]);
    w = await open();
    const tab = w.findAll('[role="tab"]').find((b) => b.text() === 'Демо')!;
    await tab.trigger('click');
    await until(() => w.find('[data-testid="ext"]').exists());
    expect(w.find('[data-testid="ext"]').text()).toBe(`ext:${t.id}`);
  });
});
