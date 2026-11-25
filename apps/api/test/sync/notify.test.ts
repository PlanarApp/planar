import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { ServerTx } from '../../src/sync/server-tx.js';
import { ChangeNotifier, Notify, parsePayload } from '../../src/sync/notify.js';
import { NOW, mkProject, mkSpace, mkUser, newDb } from './helpers.js';
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
  const projectId = await mkProject(db, spaceId);
  const write = (count: number) =>
    db.transaction(async (tx) => {
      const stx = ServerTx.asSystem(tx, { userId: owner });
      for (let i = 0; i < count; i++)
        await stx.put('labels', {
          id: uuidv7(),
          spaceId,
          projectId,
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
    await new Promise((r) => setTimeout(r, 200)); // LISTEN is set up
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
    // the first goes out at once, the rest are merged: no more than two broadcasts, the last one — the largest seq
    const mine = got.filter((x) => x > big);
    expect(mine.at(-1)).toBe(big + 3);
    expect(mine.length).toBeLessThanOrEqual(2);
    expect(mine).not.toContain(big + 2);
  });
});

describe('адресаты poke', () => {
  const pay = (f: (n: Notify) => void) => {
    const n = new Notify();
    f(n);
    return parsePayload(n.payload(7));
  };

  it('пространство и пользователь попадают в адресатов', () => {
    const { seq, target } = pay((n) => {
      n.add('s1', null, 'tasks');
      n.add(null, 'u1', 'notifications');
    });
    expect(seq).toBe(7);
    expect(target.all).toBe(false);
    expect([...target.spaces]).toEqual(['s1']);
    expect([...target.users]).toEqual(['u1']);
  });

  it('глобальная строка, смена членства и избыток адресатов — всем', () => {
    expect(pay((n) => n.add(null, null, 'users')).target.all).toBe(true);
    const m = pay((n) => n.add('s1', null, 'spaceMembers')).target;
    expect(m.all && m.membership).toBe(true);
    expect(
      pay((n) => {
        for (let i = 0; i < 40; i++) n.add(`s${i}`, null, 'tasks');
      }).target.all,
    ).toBe(true);
  });

  it('старый payload (число) и мусор — всем', () => {
    expect(parsePayload('42')).toMatchObject({ seq: 42, target: { all: true } });
    expect(parsePayload('x').target.all).toBe(true);
  });
});
