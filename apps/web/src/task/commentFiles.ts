import { computed, shallowRef } from 'vue';
import type { Row } from '@planar/shared';
import { ApiError } from '../api/http';
import { uploadWithProgress, type Uploaded } from '../api/files';
import { newId } from '../sync';

/** the body of a comment with files only */
export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/** A file of a comment being written (PLNRAPP-372): uploads at once, with progress and cancel. */
export interface DraftFile {
  key: string;
  name: string;
  mime: string;
  size: number;
  /** 0..1 */
  progress: number;
  state: 'uploading' | 'done' | 'error';
  error?: 'tooLarge' | 'uploadFailed';
  /** a local preview of an image until the upload is done */
  url?: string;
  uploaded?: Uploaded;
  abort: AbortController;
}

/** args of comment.create / comment.update `attachments` */
export type FileArgs = {
  id: string;
  fileSha256: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
};

const objectUrl = (f: File) =>
  f.type.startsWith('image/') && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(f)
    : undefined;

/** Draft files of one composer (new comment, reply, edit). */
export function useDraftFiles() {
  const items = shallowRef<DraftFile[]>([]); // shallow: AbortController must not be proxied
  const patch = (key: string, p: Partial<DraftFile>) =>
    (items.value = items.value.map((x) => (x.key === key ? { ...x, ...p } : x)));
  async function add(files: File[]) {
    await Promise.all(
      files.map(async (f) => {
        const d: DraftFile = {
          key: newId(),
          name: f.name || 'file',
          mime: f.type || 'application/octet-stream',
          size: f.size,
          progress: 0,
          state: 'uploading',
          url: objectUrl(f),
          abort: new AbortController(),
        };
        items.value = [...items.value, d];
        try {
          const r = await uploadWithProgress(f, {
            signal: d.abort.signal,
            onProgress: (progress) => patch(d.key, { progress }),
          });
          patch(d.key, { state: 'done', progress: 1, uploaded: r, mime: r.mime || d.mime });
        } catch (e) {
          if (d.abort.signal.aborted) return; // cancelled — already removed
          patch(d.key, {
            state: 'error',
            error: e instanceof ApiError && e.status === 413 ? 'tooLarge' : 'uploadFailed',
          });
        }
      }),
    );
  }
  /** cancel the upload or drop the uploaded file from the draft */
  function remove(key: string) {
    const d = items.value.find((x) => x.key === key);
    if (!d) return;
    if (d.state === 'uploading') d.abort.abort();
    if (d.url) URL.revokeObjectURL?.(d.url);
    items.value = items.value.filter((x) => x.key !== key);
  }
  function clear() {
    for (const d of [...items.value]) remove(d.key);
  }
  const busy = computed(() => items.value.some((d) => d.state === 'uploading'));
  const ready = computed(() => items.value.filter((d) => d.state === 'done'));
  /** uploaded files as mutator args; the draft keeps them until clear() */
  const args = (): FileArgs[] =>
    ready.value.map((d) => ({
      id: newId(),
      fileSha256: d.uploaded!.sha256,
      name: d.name,
      mime: d.mime,
      size: d.uploaded!.size,
      width: d.uploaded!.width,
      height: d.uploaded!.height,
    }));
  return { items, add, remove, clear, busy, ready, args };
}
export type DraftFiles = ReturnType<typeof useDraftFiles>;

/** image/* the browser shows (thumbnail and gallery); others — an icon */
export const isImage = (a: Pick<Row<'attachments'>, 'mime'>) => a.mime.startsWith('image/');

export const fileUrl = (a: Pick<Row<'attachments'>, 'fileSha256'>) => `/files/${a.fileSha256}`;
export const downloadUrl = (a: Pick<Row<'attachments'>, 'fileSha256' | 'name'>) =>
  `/files/${a.fileSha256}?name=${encodeURIComponent(a.name)}`;
export const previewUrl = (a: Pick<Row<'attachments'>, 'fileSha256'>, w: 256 | 1024 = 256) =>
  `/files/${a.fileSha256}/preview?w=${w}`;

/** 1.2 МБ / 340 КБ / 12 Б */
export function fileSize(n: number, locale = 'ru'): string {
  const ru = locale.startsWith('ru');
  const u = ru ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i ? v.toFixed(v < 10 ? 1 : 0) : v} ${u[i]}`;
}
