// PLNRAPP-858 item 10: night purge of files no row references.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filePath } from '../../src/files/store.js';
import { purgeFiles } from '../../src/jobs/files.js';
import { newDb, world, type World } from '../sync/helpers.js';

const db = newDb();
const dataDir = mkdtempSync(join(tmpdir(), 'planar-gc-'));
let w: World;
const raw = (q: string, a: unknown[] = []) => db.$client.query(q, a).then((r) => r.rows);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** File on disk + files/file_uploads rows of the given age. */
async function file(name: string, age: string, uploadAge = age) {
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
const rows = async (shas: string[]) =>
  (await raw('select sha256 from files where sha256 = any($1)', [shas])).map((r) => r.sha256);

beforeAll(async () => {
  w = await world(db);
});
afterAll(async () => {
  await db.$client.end();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('ночная очистка файлов без ссылок', () => {
  it('удаляет старые файлы без ссылок; ссылки из json, текста и bytea, свежие загрузки — держат', async () => {
    const orphan = await file('orphan', '8 days');
    const inJson = await file('json', '8 days');
    const inText = await file('text', '8 days');
    const inBytea = await file('bytea', '8 days');
    const fresh = await file('fresh', '1 day');
    const reUploaded = await file('again', '30 days', '1 hour');
    await raw(`insert into settings (id, value, updated_at) values ('gc-test', $1::jsonb, now())`, [
      JSON.stringify({ doc: { type: 'image', attrs: { src: `/files/${inJson}` } } }),
    ]);
    const state = Buffer.concat([
      Buffer.from([0, 7, 0x80]),
      Buffer.from(inBytea),
      Buffer.from([0x80]),
    ]);
    await raw(`insert into ydocs (doc_id, state, updated_at) values ($1, $2, now())`, [
      `gc:ab${inText}`,
      state,
    ]);

    const gone = await purgeFiles(db, dataDir);

    expect(gone).toEqual([orphan]);
    const all = [orphan, inJson, inText, inBytea, fresh, reUploaded];
    expect((await rows(all)).sort()).toEqual([inJson, inText, inBytea, fresh, reUploaded].sort());
    expect(existsSync(filePath(dataDir, orphan))).toBe(false);
    for (const h of all.filter((x) => x !== orphan))
      expect(existsSync(filePath(dataDir, h))).toBe(true);
    expect(await raw('select 1 from file_uploads where sha256 = $1', [orphan])).toHaveLength(0);
  });

  it('файл без копии на диске — удаляется только строка; повторный прогон ничего не делает', async () => {
    const h = await file('no-disk', '8 days');
    rmSync(filePath(dataDir, h));
    expect(await purgeFiles(db, dataDir)).toEqual([h]);
    expect(await purgeFiles(db, dataDir)).toEqual([]);
  });
});
