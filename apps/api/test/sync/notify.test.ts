import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { ServerTx } from '../../src/sync/server-tx.js';
import { ChangeNotifier } from '../../src/sync/notify.js';
import { NOW, mkSpace, mkUser, newDb } from './helpers.js';
import { uuidv7 } from '@planar/shared';

const dbs: ReturnType<typeof newDb>[] = [];
const notifiers: ChangeNotifier[] = [];
afterEach(async () => {
  await Promise.all(notifiers.splice(0).map((n) => n.onModuleDestroy()));
  await Promise.all(dbs.splice(0).map((d) => d.$client.end()));
});

async function setup() {
  const db = newDb();
  dbs.push(db);
  const n = new ChangeNotifier(db);
  notifiers.push(n);
  n.onModuleInit();
  const owner = await mkUser(db);
  const spaceId = await mkSpace(db, owner, {});
  const write = (count: number) =>
    db.transaction(async (tx) => {
      const stx = ServerTx.asSystem(tx, { userId: owner });
      for (let i = 0; i < count; i++)
        await stx.put('labels', {
          id: uuidv7(),
          spaceId,
          name: 'l',
          color: '#000',
          createdAt: NOW,
          updatedAt: NOW,
        });
      await stx.finish();
    });
  const waitFor = (pred: (s: number[]) => boolean, got: number[]) =>
    new Promise<void>((res, rej) => {
      const t0 = Date.now();
      const i = setInterval(() => {
        if (pred(got)) {
          clearInterval(i);
          res();
        } else if (Date.now() - t0 > 3000) {
          clearInterval(i);
          rej(new Error('нет poke'));
        }
      }, 10);
    });
  return { db, n, write, waitFor };
}

describe('ChangeNotifier', () => {
  it('рассылает seq подписчикам и снимает подписку', async () => {
    const { n, write, waitFor } = await setup();
    const a: number[] = [];
    const b: number[] = [];
    n.subscribe((s) => a.push(s));
    const off = n.subscribe((s) => b.push(s));
    await new Promise((r) => setTimeout(r, 200)); // LISTEN установлен
    a.length = b.length = 0;
    await write(1);
    await waitFor((x) => x.length > 0, a);
    expect(a.at(-1)).toBeGreaterThan(0);
    expect(b.at(-1)).toBe(a.at(-1));
    off();
    b.length = 0;
    await write(1);
    await waitFor((x) => x.length > 0, a);
    expect(b).toEqual([]);
  });

  it('пачка уведомлений склеивается: ≤ 2 рассылки, последняя с наибольшим seq', async () => {
    const { db, n } = await setup();
    const got: number[] = [];
    n.subscribe((s) => got.push(s));
    await new Promise((r) => setTimeout(r, 200));
    const big = 1e12;
    await db.transaction(async (tx) => {
      for (const v of [1, 3, 2])
        await tx.execute(sql`select pg_notify('planar_changes', ${String(big + v)})`);
    });
    await new Promise((r) => setTimeout(r, 300));
    // первое уходит сразу, остальные склеены: не больше двух рассылок, последняя — наибольший seq
    const mine = got.filter((x) => x > big);
    expect(mine.at(-1)).toBe(big + 3);
    expect(mine.length).toBeLessThanOrEqual(2);
    expect(mine).not.toContain(big + 2);
  });
});
