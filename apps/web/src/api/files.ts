import { ApiError, api } from './http';

export interface Uploaded {
  sha256: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
}

/** POST /files (C-http); > limit → ApiError(413). */
export function uploadFile(file: File): Promise<Uploaded> {
  const fd = new FormData();
  fd.append('file', file);
  return api<Uploaded>('POST', '/files', fd);
}

/** POST /files with upload progress (0..1) and cancel (PLNRAPP-372): XHR — fetch has no upload progress. */
export function uploadWithProgress(
  file: File,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<Uploaded> {
  if (typeof XMLHttpRequest === 'undefined') return uploadFile(file);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', file);
    x.open('POST', '/files');
    x.withCredentials = true;
    x.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let data: { code?: string; message?: string } & Partial<Uploaded> = {};
      try {
        data = JSON.parse(x.responseText) as typeof data;
      } catch {
        /* not JSON — an error by status below */
      }
      if (x.status >= 200 && x.status < 300) resolve(data as Uploaded);
      else reject(new ApiError(x.status, data.code ?? 'internal', data.message ?? x.statusText));
    };
    x.onerror = () => reject(new ApiError(0, 'network', 'network'));
    x.onabort = () => reject(new ApiError(0, 'aborted', 'aborted'));
    opts.signal?.addEventListener('abort', () => x.abort(), { once: true });
    if (opts.signal?.aborted) return x.abort();
    x.send(fd);
  });
}
