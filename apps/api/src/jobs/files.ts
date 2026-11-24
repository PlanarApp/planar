import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { filePath, filesOptsOf } from '../files/store.js';
import type { JobApi, JobDef } from '../modules/hooks.js';

type JobDb = JobApi['db'];

/** A deleted attachment's file stays this long (offline edits, undo); a file uploaded again within it stays too. */
export const FILES_GRACE = sql`interval '7 days'`;

/** Tables of the file store itself: a sha there is not a reference. */
const OWN = new Set(['files', 'file_uploads', 'files_deleted']);

/**
 * Columns that may hold a file reference. There is no contract on references: attachments.file_sha256,
 * `/files/<sha>` in JSON of descriptions and comments, chat, docs and their versions, `file:<sha>` icons,
 * Y.Doc states (bytea). So any text/json/bytea/array column of the schema is scanned for the sha.
 */
async function refColumns(db: JobDb) {
  const r = await db.execute<{ t: string; c: string; bytea: boolean }>(sql`
    select c.table_name as t, c.column_name as c, c.data_type = 'bytea' as bytea
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = current_schema() and t.table_type = 'BASE TABLE'
      and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea', 'ARRAY', 'USER-DEFINED')
    order by 1, 2`);
  return r.rows.filter((x) => !OWN.has(x.t));
}

/**
 * Candidates that occur in the column. sha256 is lowercase hex; bytea via escape keeps ASCII as is, but a byte
 * >= 0x80 turns into \ooo digits — so every 64-char window of a longer hex run is checked, not just its start.
 */
async function referenced(
  db: JobDb,
  col: { t: string; c: string; bytea: boolean },
  shas: string[],
) {
  const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
  const tbl = sql.raw(q(col.t));
  const id = sql.raw(`${q(col.t)}.${q(col.c)}`);
  const txt = col.bytea ? sql`encode(${id}, 'escape')` : sql`${id}::text`;
  const run = sql`gc_m.v[1]`;
  const r = await db.execute<{ sha: string }>(sql`
    select distinct substr(${run}, gc_i, 64) as sha
    from ${tbl}, regexp_matches(${txt}, '[0-9a-f]{64,}', 'g') as gc_m(v),
      generate_series(1, length(${run}) - 63) as gc_i
    where ${id} is not null and substr(${run}, gc_i, 64) = any(${`{${shas.join(',')}}`}::text[])`);
  return r.rows.map((x) => x.sha);
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/**
 * PLNRAPP-858 item 10: files deleted in the app — only them. A candidate is a sha from `files_deleted` (an attachment
 * with it was deleted: trigger on attachments) older than FILES_GRACE. It is purged only if no row of the database
 * references it any more and nobody uploaded it again within FILES_GRACE: then out of `files` and DATA_DIR.
 * The queue row goes away in any outcome but the grace. Files never attached (inline images, avatars, icons) are not
 * touched. Returns deleted sha.
 */
export async function purgeFiles(db: JobDb, dataDir: string): Promise<string[]> {
  const cand = await db.execute<{ sha256: string }>(sql`
    select sha256 from files_deleted where deleted_at < now() - ${FILES_GRACE} order by sha256 limit 1000`);
  const queued = cand.rows.map((r) => r.sha256);
  if (!queued.length) return [];
  const left = new Set(queued.filter((s) => /^[0-9a-f]{64}$/.test(s))); // not a sha — only out of the queue
  const fresh = await db.execute<{ sha256: string }>(sql`
    select distinct sha256 from file_uploads
    where sha256 = any(${`{${[...left].join(',')}}`}::text[]) and created_at >= now() - ${FILES_GRACE}`);
  for (const r of fresh.rows) left.delete(r.sha256);
  for (const col of await refColumns(db)) {
    if (!left.size) break;
    for (const s of await referenced(db, col, [...left])) left.delete(s);
  }
  const gone: string[] = [];
  if (left.size) {
    const trashDir = join(dataDir, 'tmp');
    await mkdir(trashDir, { recursive: true });
    for (const sha of left) if (await purgeOne(db, dataDir, trashDir, sha)) gone.push(sha);
  }
  // a delete of an attachment while the job ran moves deleted_at forward — that row stays for the next night
  await db.execute(sql`
    delete from files_deleted
    where sha256 in (${sql.join(
      queued.map((s) => sql`${s}`),
      sql`, `,
    )}) and deleted_at < now() - ${FILES_GRACE}`);
  return gone;
}

/** One file out of `files` and DATA_DIR; false — it stays (uploaded again meanwhile). */
async function purgeOne(db: JobDb, dataDir: string, trashDir: string, sha: string) {
  // Out of place first: an upload of the same content at this moment puts its own copy (commitFile sees no file),
  // and the row survives by its fresh file_uploads.
  const dest = filePath(dataDir, sha);
  const trash = join(trashDir, `gc-${randomUUID()}`);
  const moved = await rename(dest, trash).then(
    () => true,
    () => false,
  );
  const del = await db.execute<{ sha256: string }>(sql`
    delete from files f where f.sha256 = ${sha}
      and not exists (select 1 from file_uploads u
        where u.sha256 = f.sha256 and u.created_at >= now() - ${FILES_GRACE})
    returning f.sha256`);
  const ok = del.rows.length > 0;
  if (!moved) return ok;
  if (ok || (await exists(dest))) await rm(trash, { force: true });
  else await rename(trash, dest); // uploaded again meanwhile — the file stays
  return ok;
}

export const filesPurge: JobDef = {
  queue: 'core.files.purge',
  cron: '10 4 * * *',
  handler: async (_: unknown, api: JobApi) => {
    let dataDir: string;
    try {
      dataDir = filesOptsOf(api.db as unknown as Db).dataDir; // the same instance: Nest DB token
    } catch {
      return; // files are not configured in this process
    }
    const gone = await purgeFiles(api.db, dataDir);
    if (gone.length) new Logger('jobs').log(`files purge: ${gone.length} deleted`);
  },
};
