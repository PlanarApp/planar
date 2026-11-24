// PLNRAPP-858 item 10: night purge of files deleted in the app (attachments) — only them.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { uuidv7 } from '@planar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filePath } from '../../src/files/store.js';
import { purgeFiles } from '../../src/jobs/files.js';
import { newDb, taskArgs, world, type World } from '../sync/helpers.js';

const db = newDb();
const dataDir = mkdtempSync(join(tmpdir(), 'planar-gc-'));
let w: World;
let taskId: string;
const raw = (q: string, a: unknown[] = []) => db.$client.query(q, a).then((r) => r.rows);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** File on disk + files/file_uploads rows of the given age. */
async function file(name: string, age = '30 days', uploadAge = age) {
  const h = sha(name);
  const p = filePath(dataDir, h);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, name);
  await raw(
    `insert into files (sha256, size, mime, created_by, created_at) values ($1, 1, 'text/plain', $2, now() - $3::interval)`,
    [h, w.member.userId, age],
  );
  await raw(
    `insert into file_uploads (sha256, user_id, created_at) values ($1, $2, now() - $3::interval)`,
    [h, w.member.userId, uploadAge],
  );
  return h;
}
/** attachment.create of the file to the task; returns the attachment id */
async function attach(h: string) {
  const id = uuidv7();
  await w.member.ok('attachment.create', {
    id,
    taskId,
    fileSha256: h,
    name: 'f.txt',
    mime: 'text/plain',
    size: 1,
  });
  return id;
}
/** attached, then deleted in the app `ago` back */
async function deleted(h: string, ago = '8 days') {
  await w.member.ok('attachment.delete', { id: await attach(h) });
  await raw(`update files_deleted set deleted_at = now() - $2::interval where sha256 = $1`, [
    h,
    ago,
  ]);
}
const rows = async (shas: string[]) =>
  (await raw('select sha256 from files where sha256 = any($1)', [shas])).map((r) => r.sha256);
const queue = async (shas: string[]) =>
  (await raw('select sha256 from files_deleted where sha256 = any($1)', [shas])).map(
    (r) => r.sha256,
  );

beforeAll(async () => {
  w = await world(db);
  const t = taskArgs(w);
  await w.member.ok('task.create', t);
  taskId = t.id;
});
afterAll(async () => {
  await db.$client.end();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('ночная очистка файлов, удалённых в приложении', () => {
  it('удаляет только файлы удалённых вложений без других ссылок', async () => {
    const gone1 = await file('deleted');
    await deleted(gone1);
    const neverAttached = await file('never-attached'); // inline image, avatar: not deleted in the app
    const inJson = await file('json');
    await deleted(inJson);
    await raw(`insert into settings (id, value, updated_at) values ('gc-test', $1::jsonb, now())`, [
      JSON.stringify({ doc: { type: 'image', attrs: { src: `/files/${inJson}` } } }),
    ]);
    const inBytea = await file('bytea');
    await deleted(inBytea);
    await raw(`insert into ydocs (doc_id, state, updated_at) values ($1, $2, now())`, [
      `gc:${uuidv7()}`,
      Buffer.concat([Buffer.from([0, 7, 0x80]), Buffer.from(inBytea), Buffer.from([0x80])]),
    ]);
    const stillAttached = await file('still-attached');
    await deleted(stillAttached);
    await attach(stillAttached);
    const recent = await file('recent');
    await deleted(recent, '1 day');
    const reUploaded = await file('again', '30 days', '1 hour');
    await deleted(reUploaded);

    const gone = await purgeFiles(db, dataDir);

    expect(gone).toEqual([gone1]);
    const kept = [neverAttached, inJson, inBytea, stillAttached, recent, reUploaded];
    expect((await rows([gone1, ...kept])).sort()).toEqual([...kept].sort());
    expect(existsSync(filePath(dataDir, gone1))).toBe(false);
    for (const h of kept) expect(existsSync(filePath(dataDir, h))).toBe(true);
    expect(await raw('select 1 from file_uploads where sha256 = $1', [gone1])).toHaveLength(0);
    // the queue keeps only the deletions still within the grace
    expect(await queue([gone1, ...kept])).toEqual([recent]);
  });

  it('файл без копии на диске — удаляется только строка; повторный прогон ничего не делает', async () => {
    const h = await file('no-disk');
    await deleted(h);
    rmSync(filePath(dataDir, h));
    expect(await purgeFiles(db, dataDir)).toEqual([h]);
    expect(await purgeFiles(db, dataDir)).toEqual([]);
  });
});
