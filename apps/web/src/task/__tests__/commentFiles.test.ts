import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import Editor from '../editor/Editor.vue';
import { fileSize } from '../commentFiles';
import { db, eventually, flushPromises, ids, open, queued, setup, until } from './h';

// PLNRAPP-372: files of comments — upload with progress and cancel, thumbnails, gallery, download
type Up = {
  sha256: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
};
const uploads: {
  name: string;
  resolve: (u: Up) => void;
  reject: (e: unknown) => void;
  progress?: (p: number) => void;
  signal?: AbortSignal;
}[] = [];
vi.mock('../../api/files', async (orig) => ({
  ...(await orig<typeof import('../../api/files')>()),
  uploadWithProgress: (
    f: File,
    o: { onProgress?: (p: number) => void; signal?: AbortSignal } = {},
  ) =>
    new Promise<Up>((resolve, reject) => {
      uploads.push({ name: f.name, resolve, reject, progress: o.onProgress, signal: o.signal });
      o.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
}));

let w: VueWrapper;
let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  uploads.length = 0;
  t = await setup();
});
afterEach(() => w?.unmount());

const sha = (c: string) => c.repeat(64);
const up = (name: string, c: string, mime: string): Up => ({
  sha256: sha(c),
  size: 2048,
  mime,
  width: mime.startsWith('image/') ? 10 : null,
  height: mime.startsWith('image/') ? 10 : null,
});
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
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...over,
});
const file = (commentId: string, name: string, c: string, mime: string) => ({
  id: crypto.randomUUID(),
  spaceId: ids.space,
  taskId: t.id,
  commentId,
  fileSha256: sha(c),
  name,
  mime,
  size: 2048,
  width: null,
  height: null,
  uploadedBy: ids.ann,
  createdAt: `2026-11-01T10:00:0${c.charCodeAt(0) % 10}.000Z`,
});
const pick = async (sel: string, ...files: File[]) => {
  const input = w.find(sel);
  Object.defineProperty(input.element, 'files', { value: files, configurable: true });
  await input.trigger('change');
  await flushPromises();
};
const composer = () =>
  w.findAllComponents(Editor).find((e) => e.props('label').startsWith('Написать'))!;

describe('PLNRAPP-372: файлы комментария', () => {
  it('фото и файл: прогресс, «Отправить» после загрузки, comment.create с attachments', async () => {
    w = await open();
    await pick(
      '[data-testid="comment-file-input"]',
      new File(['a'], 'фото.png', { type: 'image/png' }),
      new File(['b'], 'отчёт.pdf', { type: 'application/pdf' }),
    );
    expect(w.findAll('[data-testid="draft-file"]')).toHaveLength(2);
    uploads[0]!.progress!(0.4);
    await flushPromises();
    expect(w.text()).toContain('Загрузка 40%');
    const send = () => w.find('[data-testid="comment-send"]');
    expect(send().attributes('disabled')).toBeDefined();
    uploads[0]!.resolve(up('фото.png', 'a', 'image/png'));
    uploads[1]!.resolve(up('отчёт.pdf', 'b', 'application/pdf'));
    await flushPromises();
    expect(send().attributes('disabled')).toBeUndefined();
    await send().trigger('click');
    await eventually(async () => (await queued('comment.create')).length === 1);
    const args = (await queued('comment.create'))[0]!.args as {
      attachments: { name: string; fileSha256: string; mime: string }[];
    };
    expect(args.attachments.map((a) => [a.name, a.fileSha256, a.mime])).toEqual([
      ['фото.png', sha('a'), 'image/png'],
      ['отчёт.pdf', sha('b'), 'application/pdf'],
    ]);
    expect(w.findAll('[data-testid="draft-file"]')).toHaveLength(0);
    // the comment: a thumbnail of the photo, the pdf — a download link with an icon
    await until(() => w.find('[data-testid="comment-photo"]').exists());
    expect(w.find(`img[src="/files/${sha('a')}/preview?w=256"]`).exists()).toBe(true);
    const link = w.find('[data-testid="comment-file"] a');
    expect(link.attributes('href')).toBe(
      `/files/${sha('b')}?name=${encodeURIComponent('отчёт.pdf')}`,
    );
    expect(link.attributes('download')).toBeDefined();
  });

  it('отмена загрузки: файл убран, запрос прерван; 413 — сообщение', async () => {
    w = await open();
    await pick('[data-testid="comment-file-input"]', new File(['a'], 'big.zip'));
    await w.find('[data-testid="draft-file-remove"]').trigger('click');
    await flushPromises();
    expect(uploads[0]!.signal!.aborted).toBe(true);
    expect(w.findAll('[data-testid="draft-file"]')).toHaveLength(0);
    await pick('[data-testid="comment-file-input"]', new File(['a'], 'big2.zip'));
    const { ApiError } = await import('../../api/http');
    uploads[1]!.reject(new ApiError(413, 'payload_too_large', 'x'));
    await flushPromises();
    expect(w.text()).toContain('Файл больше допустимого размера');
    expect(w.find('[data-testid="comment-send"]').attributes('disabled')).toBeDefined();
  });

  it('вставка и drop файлов в поле комментария — файлы комментария, не картинки в тексте', async () => {
    w = await open();
    const view = composer().vm.editor!.view;
    const png = new File(['a'], 'скрин.png', { type: 'image/png' });
    view.someProp('handlePaste', (f) =>
      f(view, { clipboardData: { files: [png] } } as unknown as ClipboardEvent, null as never),
    );
    view.someProp('handleDrop', (f) =>
      f(
        view,
        {
          dataTransfer: { files: [new File(['b'], 'a.txt', { type: 'text/plain' })] },
          preventDefault() {},
        } as unknown as DragEvent,
        null as never,
        false,
      ),
    );
    await flushPromises();
    expect(uploads.map((u) => u.name)).toEqual(['скрин.png', 'a.txt']);
    expect(w.findAll('[data-testid="draft-file"]')).toHaveLength(2);
    expect(JSON.stringify(composer().vm.editor!.getJSON())).not.toContain('image');
    expect(await db.table('attachments').count()).toBe(0); // not the task's files
  });

  it('галерея: листание, зум, скачивание; файлы задачи не в комментарии', async () => {
    const c = comment();
    await db.table('comments').put(c);
    await db
      .table('attachments')
      .bulkPut([
        file(c.id, '1.png', 'a', 'image/png'),
        file(c.id, '2.jpg', 'b', 'image/jpeg'),
        file(c.id, 'doc.txt', 'c', 'text/plain'),
        { ...file(c.id, 'task.png', 'd', 'image/png'), commentId: null },
      ]);
    w = await open();
    await until(() => w.findAll('[data-testid="comment-photo"]').length === 2);
    expect(w.findAll('[data-testid="comment-file"]')).toHaveLength(1);
    await w.findAll('[data-testid="comment-photo"]')[0]!.trigger('click');
    await flushPromises();
    const g = () => document.querySelector('[data-testid="gallery"]');
    await until(() => !!g());
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    expect(q('gallery-count').textContent?.trim()).toBe('1 / 2');
    expect(q('gallery-image').getAttribute('src')).toBe(`/files/${sha('a')}`);
    q('gallery-next').click();
    await flushPromises();
    expect(q('gallery-count').textContent?.trim()).toBe('2 / 2');
    expect(q('gallery-download').getAttribute('href')).toBe(`/files/${sha('b')}?name=2.jpg`);
    q('gallery-zoom-in').click();
    await flushPromises();
    expect(q('gallery-zoom').textContent?.trim()).toBe('150%');
    expect(q('gallery-image').style.transform).toContain('scale(1.5)');
    // flipping resets the zoom
    q('gallery-next').click();
    await flushPromises();
    expect(q('gallery-count').textContent?.trim()).toBe('1 / 2');
    expect(q('gallery-zoom').textContent?.trim()).toBe('100%');
    q('gallery-close').click();
    await until(() => !g());
  });

  it('правка: убрать файл и добавить новый — comment.update', async () => {
    const c = comment();
    const old = file(c.id, 'old.txt', 'a', 'text/plain');
    await db.table('comments').put(c);
    await db.table('attachments').put(old);
    w = await open();
    await until(() => w.find('[data-testid="comment-edit"]').exists());
    await w.find('[data-testid="comment-edit"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="comment-file-remove"]').trigger('click');
    const inputs = w.findAll('[data-testid="comment-file-input"]');
    const input = inputs[inputs.length - 1]!;
    Object.defineProperty(input.element, 'files', {
      value: [new File(['n'], 'new.txt', { type: 'text/plain' })],
    });
    await input.trigger('change');
    await flushPromises();
    uploads[0]!.resolve(up('new.txt', 'e', 'text/plain'));
    await flushPromises();
    await w.find('[data-testid="comment-save"]').trigger('click');
    await eventually(async () => (await queued('comment.update')).length === 1);
    const a = (await queued('comment.update'))[0]!.args as {
      removeAttachments: string[];
      attachments: { name: string }[];
    };
    expect(a.removeAttachments).toEqual([old.id]);
    expect(a.attachments.map((x) => x.name)).toEqual(['new.txt']);
    await eventually(async () => {
      const rows = await db.table('attachments').toArray();
      return rows.length === 1 && rows[0].name === 'new.txt';
    });
  });

  it('fileSize', () => {
    expect(fileSize(12)).toBe('12 Б');
    expect(fileSize(1536)).toBe('1.5 КБ');
    expect(fileSize(100 * 1024 * 1024, 'en')).toBe('100 MB');
  });
});
