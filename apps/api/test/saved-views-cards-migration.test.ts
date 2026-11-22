// PLNRAPP-707: migration 0080 on data — saved views of the removed layout «cards» -> «list»
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, migrate } from '../src/db/index.js';

const drizzleDir = new URL('../drizzle', import.meta.url).pathname;
const sqlFile = join(drizzleDir, '0080_cards_view_to_list.sql');
const name = `planar_t_mig80_${randomBytes(5).toString('hex')}`;
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

type View = {
  id: string;
  name: string;
  layout: string;
  node: string | null;
  user_id: string | null;
};
const views = () =>
  q<View>(`select id, name, layout, node, user_id from saved_views order by name, layout`);
const resets = () =>
  q<{ id: string }>(`select id from changes where entity = '_reset' order by seq`);

// before the migration:
// named views — «Mine» (personal, cards), «Shared» (shared, cards), «Board» (board);
// node tabs of p:1 — my cards row and my list row (the List row stays, the Cards row is dropped);
// node tabs of p:2 — my cards row only, the shared cards default (both become List rows)
const ids: Record<string, string> = {};
let u1 = '';

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  db = createDb(url.toString());

  tmp = mkdtempSync(join(tmpdir(), 'mig80-'));
  cpSync(drizzleDir, tmp, { recursive: true });
  const jp = join(tmp, 'meta/_journal.json');
  const j = JSON.parse(readFileSync(jp, 'utf8'));
  const all = j.entries;
  j.entries = all.filter((e: { idx: number }) => e.idx < 80);
  writeFileSync(jp, JSON.stringify(j));
  await migrate(db, tmp);

  u1 = await id(
    `insert into users (login, name, role, password_hash) values ('mig80', 'mig80', 'owner', 'x') returning id`,
  );
  const space = await id(
    `insert into spaces (name, rank, created_by) values ('S', 'a0', $1) returning id`,
    [u1],
  );
  const view = (
    key: string,
    n: string,
    layout: string,
    node: string | null,
    userId: string | null,
  ) =>
    id(
      `insert into saved_views (space_id, user_id, created_by, name, layout, node, filter, config, rank)
       values ($1, $2, $3, $4, $5, $6, '{}', '{"groupBy":"status"}', 'a0') returning id`,
      [space, userId, u1, n, layout, node, userId],
    ).then((v) => (ids[key] = v));
  await view('mine', 'Mine', 'cards', null, u1);
  await view('shared', 'Shared', 'cards', null, null);
  await view('board', 'Board', 'board', null, u1);
  await view('p1cards', 'cards', 'cards', 'p:1', u1);
  await view('p1list', 'list', 'list', 'p:1', u1);
  await view('p2cards', 'cards', 'cards', 'p:2', u1);
  await view('p2shared', 'cards', 'cards', 'p:2', null);

  await q(`delete from changes`); // so that the only row after the migration is the one it writes
  await migrate(db, drizzleDir); // 0080 and later
}, 120_000);

afterAll(async () => {
  await db?.$client.end();
  await admin?.query(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin?.end();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('PLNRAPP-707 миграция 0080: сохранённые виды «Карточки» -> «Список»', () => {
  it('вида с раскладкой cards не остаётся', async () => {
    expect((await views()).filter((v) => v.layout === 'cards')).toEqual([]);
  });

  it('именованные виды (личный и общий) открываются как Список, название и настройки те же', async () => {
    const v = await q<{ id: string; name: string; layout: string; config: unknown }>(
      `select id, name, layout, config from saved_views where id = any($1)`,
      [[ids.mine, ids.shared, ids.board]],
    );
    const by = Object.fromEntries(v.map((r) => [r.id, r]));
    expect(by[ids.mine!]).toMatchObject({
      name: 'Mine',
      layout: 'list',
      config: { groupBy: 'status' },
    });
    expect(by[ids.shared!]).toMatchObject({ name: 'Shared', layout: 'list' });
    expect(by[ids.board!]).toMatchObject({ name: 'Board', layout: 'board' });
  });

  it('вкладка узла: есть строка Списка — строка Карточек удалена; нет — она становится строкой Списка', async () => {
    const rows = (await views()).filter((v) => v.node);
    const of = (node: string) =>
      rows
        .filter((v) => v.node === node)
        .map((v) => ({ id: v.id, name: v.name, layout: v.layout, user: v.user_id }));
    expect(of('p:1')).toEqual([{ id: ids.p1list, name: 'list', layout: 'list', user: u1 }]);
    expect(of('p:2').sort((a, b) => String(a.user).localeCompare(String(b.user)))).toEqual(
      [
        { id: ids.p2cards, name: 'list', layout: 'list', user: u1 },
        { id: ids.p2shared, name: 'list', layout: 'list', user: null },
      ].sort((a, b) => String(a.user).localeCompare(String(b.user))),
    );
  });

  it('клиентам — одна строка _reset', async () => {
    expect((await resets()).map((r) => r.id)).toEqual(['plnrapp-707-cards-view-to-list']);
  });

  it('повторный запуск ничего не меняет и не пишет _reset', async () => {
    const first = await q(`select id, layout, updated_at from saved_views order by id`);
    await db.$client.query(readFileSync(sqlFile, 'utf8'));
    expect(await q(`select id, layout, updated_at from saved_views order by id`)).toEqual(first);
    expect((await resets()).length).toBe(1);
  });
});
