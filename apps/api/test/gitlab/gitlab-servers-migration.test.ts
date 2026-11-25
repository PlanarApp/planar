// Migration 0092: the per-project GitLab connections (host + token) -> workspace connections + the bindings' serverId
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, migrate } from '../../src/db/index.js';

const drizzleDir = new URL('../../drizzle', import.meta.url).pathname;
const sqlFile = join(drizzleDir, '0092_gitlab_servers.sql');
const name = `planar_t_mig92_${randomBytes(5).toString('hex')}`;
const adminUrl = inject('dbAdminUrl');
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let admin: pg.Client;
let db: ReturnType<typeof createDb>;
let tmp: string;
const ids: Record<string, string> = {};

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await db.$client.query(text, params)).rows as T[];
const id = async (text: string, params: unknown[] = []) =>
  (await q<{ id: string }>(text, params))[0]!.id;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  db = createDb(url.toString());

  tmp = mkdtempSync(join(tmpdir(), 'mig92-'));
  cpSync(drizzleDir, tmp, { recursive: true });
  const jp = join(tmp, 'meta/_journal.json');
  const j = JSON.parse(readFileSync(jp, 'utf8'));
  const all = j.entries;
  j.entries = all.filter((e: { idx: number }) => e.idx < 92);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);

  const user = await id(
    `insert into users (login, name, role, password_hash) values ('mig92', 'm', 'owner', 'x') returning id`,
  );
  const space = await id(
    `insert into spaces (name, rank, created_by) values ('S', 'a0', $1) returning id`,
    [user],
  );
  for (const [k, key] of [
    ['p1', 'AA'],
    ['p2', 'BB'],
    ['p3', 'CC'],
  ] as const)
    ids[k] = await id(
      `insert into projects (space_id, name, key, rank) values ($1, $2, $3, 'a0') returning id`,
      [space, k, key],
    );
  // p1, p2 — host A with token A (p1 is the oldest); p3 — host B
  const conn = (p: string, base: string, tok: string, repo: number, at: string) =>
    q(
      `insert into gitlab_connections (id, project_id, base_url, token_enc, gitlab_project_id, path, created_at)
       values (gen_random_uuid(), $1, $2, $3, $4, 'g/p', $5)`,
      [ids[p], base, tok, repo, at],
    );
  await conn('p1', 'https://a.example', 'tokA', 1, '2026-01-01');
  await conn('p2', 'https://a.example', 'tokA', 1, '2026-02-01');
  await conn('p3', 'https://b.example', 'tokB', 2, '2026-03-01');
  await conn('p3', 'https://a.example', 'tokA', 3, '2026-03-02');
  j.entries = all.filter((e: { idx: number }) => e.idx <= 92);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);
}, 120_000);

afterAll(async () => {
  await db?.$client.end();
  await admin?.query(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin?.end();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const servers = () =>
  q<{ id: string; scope: string; scope_id: string; base_url: string; token_enc: string }>(
    `select * from gitlab_servers order by created_at, id`,
  );
const serverOf = async (project: string, repo: number) =>
  (
    await q<{ base_url: string; token_enc: string }>(
      `select s.base_url, s.token_enc from gitlab_connections c join gitlab_servers s on s.id = c.server_id
       where c.project_id = $1 and c.gitlab_project_id = $2`,
      [ids[project], repo],
    )
  )[0];

describe('миграция 0092: подключения GitLab -> глобальные', () => {
  it('одинаковые (адрес, токен) сливаются в одно глобальное подключение; самое старое — первое', async () => {
    const s = await servers();
    expect(s.map((x) => [x.scope, x.scope_id, x.base_url, x.token_enc])).toEqual([
      ['workspace', '00000000-0000-0000-0000-000000000000', 'https://a.example', 'tokA'],
      ['workspace', '00000000-0000-0000-0000-000000000000', 'https://b.example', 'tokB'],
    ]);
  });

  it('привязки продолжают работать: у каждой тот же адрес и токен, что были', async () => {
    expect(await serverOf('p1', 1)).toEqual({ base_url: 'https://a.example', token_enc: 'tokA' });
    expect(await serverOf('p2', 1)).toEqual({ base_url: 'https://a.example', token_enc: 'tokA' });
    expect(await serverOf('p3', 2)).toEqual({ base_url: 'https://b.example', token_enc: 'tokB' });
    expect(await serverOf('p3', 3)).toEqual({ base_url: 'https://a.example', token_enc: 'tokA' });
    expect(
      await q(
        `select 1 from information_schema.columns where table_name = 'gitlab_connections' and column_name in ('base_url','token_enc')`,
      ),
    ).toHaveLength(0);
  });

  it('проект не на первом подключении получает явный выбор; остальные наследуют', async () => {
    const s = await servers();
    const ch = await q<{ scope: string; scope_id: string; server_id: string }>(
      `select * from gitlab_choices`,
    );
    expect(ch).toEqual([{ scope: 'project', scope_id: ids.p3, server_id: s[1]!.id }]);
  });

  it('повторный запуск не ломается на уже перенесённых данных', async () => {
    await expect(db.$client.query(readFileSync(sqlFile, 'utf8'))).rejects.toThrow();
    expect(await servers()).toHaveLength(2);
  });
});
