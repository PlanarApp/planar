import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/vue-3';
import { editorExtensions } from '@planar/editor';
import { fileHref, insertUploads } from './upload';

const SHA = 'a'.repeat(64);
const up = (sha = SHA) =>
  vi.fn(async (f: File) => ({ sha256: sha, size: f.size, mime: f.type, width: null, height: null }));
let ed: Editor;
const mk = (text = 'ab') =>
  (ed = new Editor({
    extensions: editorExtensions({ image: true }),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  }));
afterEach(() => ed?.destroy());

describe('PLNRAPP-832: вставка файлов в документ', () => {
  it('изображение из буфера вставляется картинкой /files/<sha>', async () => {
    mk();
    const upload = up();
    const errs = await insertUploads(ed, [new File(['x'], 'shot.png', { type: 'image/png' })], upload);
    expect(errs).toEqual([]);
    expect(upload).toHaveBeenCalledOnce();
    let img: { attrs?: object } | undefined;
    ed.state.doc.descendants((n) => void (n.type.name === 'image' && (img = n)));
    expect(img?.attrs).toMatchObject({ src: `/files/${SHA}`, alt: 'shot.png' });
  });

  it('перетащенный файл вставляется ссылкой с именем в точку сброса', async () => {
    mk('ab');
    await insertUploads(ed, [new File(['%PDF'], 'отчёт 1.pdf', { type: 'application/pdf' })], up(), 2);
    const p = ed.getJSON().content![0]!;
    expect(p.content![0]).toEqual({ type: 'text', text: 'a' });
    expect(p.content![1]).toMatchObject({
      text: 'отчёт 1.pdf',
      marks: [{ type: 'link', attrs: { href: fileHref(SHA, 'отчёт 1.pdf') } }],
    });
    expect(fileHref(SHA, 'отчёт 1.pdf')).toBe(`/files/${SHA}?name=${encodeURIComponent('отчёт 1.pdf')}`);
    expect(ed.getText()).toBe('aотчёт 1.pdf b');
  });

  it('несколько файлов идут по порядку; упавшая загрузка не мешает остальным', async () => {
    mk('');
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ sha256: SHA, size: 1, mime: 'text/plain', width: null, height: null })
      .mockRejectedValueOnce(new Error('413'))
      .mockResolvedValueOnce({ sha256: 'b'.repeat(64), size: 1, mime: 'text/plain', width: null, height: null });
    const files = ['1.txt', '2.txt', '3.txt'].map((n) => new File(['x'], n, { type: 'text/plain' }));
    const errs = await insertUploads(ed, files, upload, 1);
    expect(errs).toHaveLength(1);
    expect(ed.getText()).toBe('1.txt 3.txt ');
  });
});
