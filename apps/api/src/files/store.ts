import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { HttpError } from '../auth/errors.js';
import type { Db } from '../db/index.js';
import { fileUploads, files } from '../db/schema.js';

export type FilesOpts = { dataDir: string; maxUploadMb: number };

export const filePath = (dataDir: string, sha: string) =>
  join(dataDir, 'files', sha.slice(0, 2), sha.slice(2, 4), sha);

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** tmp file already hashed by sha → into place in DATA_DIR, files and file_uploads rows. Tmp is removed in any outcome. */
export async function commitFile(
  db: Db,
  dataDir: string,
  f: { tmp: string; sha: string; size: number; mime: string; userId: string },
) {
  const dest = filePath(dataDir, f.sha);
  try {
    let width: number | null = null;
    let height: number | null = null;
    if (f.mime.startsWith('image/')) {
      try {
        const m = await sharp(f.tmp).metadata();
        width = m.width ?? null;
        height = m.height ?? null;
      } catch {
        // not an image or broken — no dimensions
      }
    }
    if (await exists(dest)) await rm(f.tmp);
    else {
      await mkdir(join(dest, '..'), { recursive: true });
      await rename(f.tmp, dest);
    }
    await db
      .insert(files)
      .values({ sha256: f.sha, size: f.size, mime: f.mime, width, height, createdBy: f.userId })
      .onConflictDoNothing();
    await db.insert(fileUploads).values({ sha256: f.sha, userId: f.userId }).onConflictDoNothing();
  } catch (e) {
    await rm(f.tmp, { force: true });
    throw e;
  }
  const [row] = await db.select().from(files).where(eq(files.sha256, f.sha));
  return {
    sha256: f.sha,
    size: row!.size,
    mime: row!.mime,
    width: row!.width,
    height: row!.height,
  };
}

/** File from memory (CoreServices.storeFile): the same write path as POST /files; over the limit → 413. */
export async function storeBuffer(
  db: Db,
  opts: FilesOpts,
  buf: Buffer,
  userId: string,
  mime = 'application/octet-stream',
) {
  if (buf.length > opts.maxUploadMb * 1024 * 1024)
    throw new HttpError(413, 'payload_too_large', 'Файл слишком большой');
  const tmpDir = join(opts.dataDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const tmp = join(tmpDir, randomUUID());
  await writeFile(tmp, buf);
  const sha = createHash('sha256').update(buf).digest('hex');
  return commitFile(db, opts.dataDir, { tmp, sha, size: buf.length, mime, userId });
}
