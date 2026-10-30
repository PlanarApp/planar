import { api } from './http';

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
