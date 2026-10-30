import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  attachments,
  fileUploads,
  projects,
  spaceMembers,
  spaces,
  statuses,
  tasks,
  users,
} from '../../src/db/schema.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { testDb, testDbUrl } from '../db.js';

const db = testDb();
const dataDir = mkdtempSync(join(tmpdir(), 'planar-files-'));
let app: Awaited<ReturnType<typeof createApp>>;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function multipart(fields: { name: string; data: Buffer; type?: string }[]) {
  const boundary = '----t' + Math.random().toString(16).slice(2);
  const parts = fields.flatMap((f) => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="x.bin"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`,
    ),
    f.data,
    Buffer.from('\r\n'),
  ]);
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(
  cookie: string | undefined,
  data: Buffer,
  type?: string,
  o: { origin?: string | null; name?: string } = {},
) {
  const { payload, ...h } = multipart([{ name: o.name ?? 'file', data, type }]);
  const headers: Record<string, string> = { ...h };
  if (cookie) headers.cookie = cookie;
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  return app
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'POST', url: '/files', headers, payload });
}
const get = (url: string, cookie?: string, headers: Record<string, string> = {}) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'GET', url, headers: { ...(cookie ? { cookie } : {}), ...headers } });

const text = Buffer.from('hello planar files');
let png: Buffer;
let alice: string;
let bob: string;
let aliceId: string;
let bobId: string;

beforeAll(async () => {
  png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#f00' } })
    .png()
    .toBuffer();
  app = await createApp({ databaseUrl: testDbUrl(), publicUrl: ORIGIN, dataDir, maxUploadMb: 1 });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const a = await createUser(db);
  const b = await createUser(db);
  aliceId = a.id;
  bobId = b.id;
  alice = await loginCookie(db, a.id);
  bob = await loginCookie(db, b.id);
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('POST /files', () => {
  it('201 и верный sha256', async () => {
    const res = await upload(alice, text, 'text/plain');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      sha256: sha(text),
      size: text.length,
      mime: 'text/plain',
      width: null,
      height: null,
    });
  });

  it('картинка → width/height', async () => {
    const res = await upload(alice, png, 'image/png');
    expect(res.json()).toMatchObject({ width: 600, height: 400 });
  });

  it('битая «картинка» → размеры null', async () => {
    const res = await upload(alice, Buffer.from('not an image'), 'image/png');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ width: null, height: null });
  });

  it('дедупликация: два пользователя, один файл на диске, две file_uploads', async () => {
    const data = Buffer.from('dedup ' + Math.random());
    const h = sha(data);
    expect((await upload(alice, data)).statusCode).toBe(201);
    expect((await upload(bob, data)).statusCode).toBe(201);
    expect(readdirSync(join(dataDir, 'files', h.slice(0, 2), h.slice(2, 4)))).toEqual([h]);
    expect(await db.select().from(fileUploads).where(eq(fileUploads.sha256, h))).toHaveLength(2);
    expect((await get(`/files/${h}`, alice)).statusCode).toBe(200);
    expect((await get(`/files/${h}`, bob)).statusCode).toBe(200);
  });

  it('превышение лимита → 413, tmp пуст', async () => {
    const res = await upload(alice, Buffer.alloc(1024 * 1024 + 10, 1));
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('payload_too_large');
    expect(readdirSync(join(dataDir, 'tmp'))).toEqual([]);
  });

  it('другое имя поля → 400', async () => {
    const res = await upload(alice, text, undefined, { name: 'other' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_request');
  });

  it('два поля file → 400, tmp пуст', async () => {
    const { payload, ...h } = multipart([
      { name: 'file', data: text },
      { name: 'file', data: text },
    ]);
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/files',
        headers: { ...h, cookie: alice, origin: ORIGIN },
        payload,
      });
    expect(res.statusCode).toBe(400);
    expect(readdirSync(join(dataDir, 'tmp'))).toEqual([]);
  });

  it('без cookie → 401', async () => {
    expect((await upload(undefined, text)).statusCode).toBe(401);
  });

  it('без Origin → 403 origin_mismatch', async () => {
    const res = await upload(alice, text, undefined, { origin: null });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('origin_mismatch');
  });
});

describe('GET /files/:sha256', () => {
  it('тот же пользователь — байты совпадают, заголовки', async () => {
    const data = Buffer.from('bytes ' + Math.random());
    await upload(alice, data, 'text/plain');
    const res = await get(`/files/${sha(data)}`, alice);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(data)).toBe(true);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-length']).toBe(String(data.length));
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('чужой без прав → 404; кривой sha → 404', async () => {
    const data = Buffer.from('private ' + Math.random());
    await upload(alice, data);
    const res = await get(`/files/${sha(data)}`, bob);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
    expect((await get('/files/xyz', alice)).statusCode).toBe(404);
  });

  it('участник пространства с вложением → 200', async () => {
    const data = Buffer.from('attached ' + Math.random());
    await upload(alice, data);
    const [sp] = await db
      .insert(spaces)
      .values({ name: 's', rank: 'a', createdBy: aliceId })
      .returning();
    const [pr] = await db
      .insert(projects)
      .values({
        spaceId: sp!.id,
        name: 'p',
        key: 'F' + Math.random().toString(36).slice(2, 8),
        rank: 'a',
      })
      .returning();
    const [st] = await db
      .insert(statuses)
      .values({ spaceId: sp!.id, name: 'x', category: 'todo', color: '#000', rank: 'a' })
      .returning();
    const [t] = await db
      .insert(tasks)
      .values({
        spaceId: sp!.id,
        projectId: pr!.id,
        statusId: st!.id,
        title: 't',
        priority: 0,
        rank: 'a',
        createdBy: aliceId,
      })
      .returning();
    await db.insert(attachments).values({
      spaceId: sp!.id,
      taskId: t!.id,
      fileSha256: sha(data),
      name: 'a',
      mime: 'application/octet-stream',
      size: data.length,
      uploadedBy: aliceId,
    });
    expect((await get(`/files/${sha(data)}`, bob)).statusCode).toBe(404);
    await db.insert(spaceMembers).values({ spaceId: sp!.id, userId: bobId, role: 'member' });
    expect((await get(`/files/${sha(data)}`, bob)).statusCode).toBe(200);
  });

  it('аватар виден всем', async () => {
    const data = Buffer.from('avatar ' + Math.random());
    await upload(alice, data);
    expect((await get(`/files/${sha(data)}`, bob)).statusCode).toBe(404);
    await db
      .update(users)
      .set({ avatarFile: sha(data) })
      .where(eq(users.id, aliceId));
    expect((await get(`/files/${sha(data)}`, bob)).statusCode).toBe(200);
    await db.update(users).set({ avatarFile: null }).where(eq(users.id, aliceId));
  });

  it('картинка-иконка проекта — участникам пространства', async () => {
    const data = Buffer.from('icon ' + Math.random());
    await upload(alice, data);
    const [sp] = await db
      .insert(spaces)
      .values({ name: 's', rank: 'a', createdBy: aliceId })
      .returning();
    await db.insert(projects).values({
      spaceId: sp!.id,
      name: 'p',
      key: 'I' + Math.random().toString(36).slice(2, 8),
      rank: 'a',
      icon: `file:${sha(data)}`,
    });
    expect((await get(`/files/${sha(data)}`, bob)).statusCode).toBe(404);
    await db.insert(spaceMembers).values({ spaceId: sp!.id, userId: bobId, role: 'member' });
    expect((await get(`/files/${sha(data)}`, bob)).statusCode).toBe(200);
  });

  it('ETag / If-None-Match → 304', async () => {
    const h = sha(text);
    const res = await get(`/files/${h}`, alice);
    expect(res.headers.etag).toBe(`"${h}"`);
    const r2 = await get(`/files/${h}`, alice, { 'if-none-match': `"${h}"` });
    expect(r2.statusCode).toBe(304);
  });

  it('?name= → Content-Disposition attachment', async () => {
    const res = await get(`/files/${sha(text)}?name=${encodeURIComponent('отчёт.txt')}`, alice);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('отчёт.txt')}`,
    );
  });

  it('без cookie → 401', async () => {
    expect((await get(`/files/${sha(text)}`)).statusCode).toBe(401);
  });
});

describe('GET /files/:sha256/preview', () => {
  it('png → webp шириной ≤ 256, кеш на диске', async () => {
    const res = await get(`/files/${sha(png)}/preview?w=256`, alice);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    const m = await sharp(res.rawPayload).metadata();
    expect(m.format).toBe('webp');
    expect(m.width).toBeLessThanOrEqual(256);
    expect(existsSync(join(dataDir, 'previews', `${sha(png)}_256.webp`))).toBe(true);
  });

  it('w=1024 не увеличивает', async () => {
    const res = await get(`/files/${sha(png)}/preview?w=1024`, alice);
    expect((await sharp(res.rawPayload).metadata()).width).toBe(600);
  });

  it('не картинка → 404', async () => {
    expect((await get(`/files/${sha(text)}/preview?w=256`, alice)).statusCode).toBe(404);
  });

  it('файла нет на диске → 404', async () => {
    const b = Buffer.from('gone-' + Math.random());
    const up = await upload(alice, b, 'image/png');
    const { sha256 } = up.json();
    rmSync(join(dataDir, 'files', sha256.slice(0, 2), sha256.slice(2, 4), sha256));
    expect((await get(`/files/${sha256}/preview?w=256`, alice)).statusCode).toBe(404);
  });

  it('битая «картинка» → 500 internal', async () => {
    const b = Buffer.from('broken-' + Math.random());
    const { sha256 } = (await upload(alice, b, 'image/png')).json();
    const res = await get(`/files/${sha256}/preview?w=256`, alice);
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('internal');
  });

  it('w=999 → 400', async () => {
    expect((await get(`/files/${sha(png)}/preview?w=999`, alice)).statusCode).toBe(400);
  });

  it('чужой → 404', async () => {
    expect((await get(`/files/${sha(png)}/preview?w=256`, bob)).statusCode).toBe(404);
  });
});
