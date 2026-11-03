// PJ-3: migration 0033 on data — data modules of settings.enabled_modules move to projects.modules of every project
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, migrate } from '../../src/db/index.js';

const drizzleDir = new URL('../../drizzle', import.meta.url).pathname;
const name = `planar_t_mig3_${randomBytes(5).toString('hex')}`;
const adminUrl = inject('dbAdminUrl');
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let admin: pg.Client;
let db: ReturnType<typeof createDb>;
let tmp: string;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await db.$client.query(text, params)).rows as T[];
const id = async (text: string, params: unknown[] = []) =>
  (await q<{ id: string }>(text, params))[0]!.id;

const keys = ['PA', 'PB', 'PC', 'PD'];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  db = createDb(url.toString());

  // the schema before 0033: the migrations folder cut at idx 32
  tmp = mkdtempSync(join(tmpdir(), 'pj3-'));
  cpSync(drizzleDir, tmp, { recursive: true });
  const jp = join(tmp, 'meta/_journal.json');
  const j = JSON.parse(readFileSync(jp, 'utf8'));
  const all = j.entries;
  j.entries = all.filter((e: { idx: number }) => e.idx < 33);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);

  const user = await id(
    `insert into users (login, name, role, password_hash) values ('mig3', 'Mig', 'owner', 'x') returning id`,
  );
  const space = (n: string) =>
    id(`insert into spaces (name, rank, created_by) values ($1, 'a0', $2) returning id`, [n, user]);
  const [s1, s2] = [await space('S1'), await space('S2')];
  // 2 spaces, 4 projects (one archived, one in a space of its own)
  for (const [i, k] of keys.entries())
    await q(
      `insert into projects (space_id, name, key, rank, archived_at) values ($1, $2, $2, 'a0', $3)`,
      [i < 3 ? s1 : s2, k, k === 'PC' ? new Date().toISOString() : null],
    );
  // data modules (time, docs, gitlab) and shared ones (chat, webhooks) are enabled, plus an unknown id
  await q(`insert into settings (id, value) values ('enabled_modules', $1::jsonb)`, [
    JSON.stringify(['time', 'chat', 'docs', 'webhooks', 'gitlab', 'ghost']),
  ]);
  await q(`delete from changes`); // so that the only row after the migration is the one it writes
  j.entries = all;
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp); // 0033
}, 120_000);

afterAll(async () => {
  await db?.$client.end();
  await admin?.query(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin?.end();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('PJ-3 миграция 0033: модули данных экземпляра -> проекты', () => {
  it('PJ-3 каждый проект (и архивный) получает модули данных из enabled_modules, в порядке списка', async () => {
    const rows = await q<{ key: string; modules: string[] }>(
      `select key, modules from projects order by key`,
    );
    expect(rows.map((r) => r.key)).toEqual(keys);
    for (const r of rows) expect(r.modules, r.key).toEqual(['time', 'docs', 'gitlab']);
  });

  it('PJ-3 в enabled_modules остаются только общие модули (и неизвестные id не теряются)', async () => {
    const [s] = await q<{ value: string[] }>(
      `select value from settings where id = 'enabled_modules'`,
    );
    expect(s!.value).toEqual(['chat', 'webhooks', 'ghost']);
  });

  it('PJ-3 доставка клиентам: одна глобальная строка _reset в changes -> reset на ближайшем pull', async () => {
    // (the later migration 0034 adds its own _reset)
    expect(
      await q(
        `select entity, id, op, space_id, user_id from changes where id = 'pj-3-project-modules'`,
      ),
    ).toEqual([
      { entity: '_reset', id: 'pj-3-project-modules', op: 'put', space_id: null, user_id: null },
    ]);
  });

  it('PJ-3 новый проект без явного значения — без модулей', async () => {
    const [sp] = await q<{ id: string }>(`select id from spaces limit 1`);
    const [p] = await q<{ modules: string[] }>(
      `insert into projects (space_id, name, key, rank) values ($1, 'N', 'PNEW', 'a0') returning modules`,
      [sp!.id],
    );
    expect(p!.modules).toEqual([]);
  });
});
