// Migration 0102 (PLNRAPP-890): the workspace GitHub connection of 0101 -> a connection of the workspace level
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, migrate } from '../../src/db/index.js';

const drizzleDir = new URL('../../drizzle', import.meta.url).pathname;
const name = `planar_t_mig102_${randomBytes(5).toString('hex')}`;
const adminUrl = inject('dbAdminUrl');
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let admin: pg.Client;
let db: ReturnType<typeof createDb>;
let tmp: string;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await db.$client.query(text, params)).rows as T[];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  db = createDb(url.toString());

  tmp = mkdtempSync(join(tmpdir(), 'mig102-'));
  cpSync(drizzleDir, tmp, { recursive: true });
  const jp = join(tmp, 'meta/_journal.json');
  const j = JSON.parse(readFileSync(jp, 'utf8'));
  const all = j.entries;
  j.entries = all.filter((e: { idx: number }) => e.idx < 102);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);
  await q(
    `insert into github_connections (id, login, token_enc, connected_by)
     values (gen_random_uuid(), 'octo', 'enc', gen_random_uuid())`,
  );
  j.entries = all.filter((e: { idx: number }) => e.idx <= 102);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);
}, 120_000);

afterAll(async () => {
  await db?.$client.end();
  await admin?.query(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin?.end();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('миграция 0102: подключения GitHub по уровням', () => {
  it('прежнее подключение становится подключением воркспейса, выборов нет', async () => {
    expect(await q(`select scope, scope_id, login, token_enc from github_connections`)).toEqual([
      {
        scope: 'workspace',
        scope_id: '00000000-0000-0000-0000-000000000000',
        login: 'octo',
        token_enc: 'enc',
      },
    ]);
    expect(await q(`select * from github_choices`)).toHaveLength(0);
  });

  it('у scope и scope_id нет значения по умолчанию', async () => {
    const cols = await q<{ column_default: string | null }>(
      `select column_default from information_schema.columns
       where table_name = 'github_connections' and column_name in ('scope', 'scope_id')`,
    );
    expect(cols).toEqual([{ column_default: null }, { column_default: null }]);
  });
});
