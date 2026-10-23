import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { TestClient, mkUser, newDb, services, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

describe('reset', () => {
  it('добавление участника → reset у него, не у других', async () => {
    const w = await world(db);
    const { cursor: cm } = await w.member.bootstrap();
    const { cursor: co } = await w.outsider.bootstrap();
    const stranger = new TestClient(services(db), await mkUser(db));
    const { cursor: cs } = await stranger.bootstrap();
    await w.admin.ok('member.add', {
      id: uuidv7(),
      spaceId: w.spaceId,
      userId: w.outsider.userId,
      role: 'member',
    });
    expect(await w.outsider.pull(co)).toMatchObject({ reset: true, changes: [] });
    const m = await w.member.pull(cm);
    expect(m.reset).toBeUndefined();
    expect(m.changes.some((c) => c.entity === 'spaceMembers')).toBe(true);
    expect((await stranger.pull(cs)).reset).toBeUndefined();
  });

  it('после reset bootstrap даёт новые данные, а pull с его cursor — чистый', async () => {
    const w = await world(db);
    const { cursor } = await w.outsider.bootstrap();
    await w.admin.ok('member.add', {
      id: uuidv7(),
      spaceId: w.spaceId,
      userId: w.outsider.userId,
      role: 'guest',
    });
    expect((await w.outsider.pull(cursor)).reset).toBe(true);
    const b = await w.outsider.bootstrap();
    expect(b.data.spaces!.map((s) => s.id)).toContain(w.spaceId);
    expect(await w.outsider.pull(b.cursor)).toMatchObject({ changes: [] });
  });

  it('удаление участника → reset у него, не у остальных', async () => {
    const w = await world(db);
    const { cursor: cg } = await w.guest.bootstrap();
    const { cursor: cm } = await w.member.bootstrap();
    const mem = (await w.admin.bootstrap()).data.spaceMembers!.find(
      (x) => x.spaceId === w.spaceId && x.userId === w.guest.userId,
    )!;
    await w.admin.ok('member.remove', { id: mem.id as string });
    expect((await w.guest.pull(cg)).reset).toBe(true);
    expect((await w.guest.bootstrap()).data.spaces!.map((s) => s.id)).not.toContain(w.spaceId);
    expect((await w.member.pull(cm)).reset).toBeUndefined();
  });

  it('cursor больше max журнала → reset', async () => {
    const w = await world(db);
    const r = await w.member.pull(2 ** 40);
    expect(r).toMatchObject({ reset: true, changes: [] });
  });

  it('cursor = 0 на непустом журнале — без reset, если журнал не обрезан', async () => {
    const w = await world(db);
    const r = await w.member.pull((await w.member.bootstrap()).cursor);
    expect(r.reset).toBeUndefined();
  });

  it('больше 5000 видимых изменений → reset', async () => {
    const w = await world(db);
    const { cursor } = await w.member.bootstrap();
    await db.execute(sql`
      insert into changes (space_id, entity, id, op, data)
      select ${w.spaceId}::uuid, 'labels', g::text, 'del', null from generate_series(1, 5001) g`);
    expect(await w.member.pull(cursor)).toMatchObject({ reset: true, changes: [] });
    expect((await w.outsider.pull(cursor)).reset).toBeUndefined();
  });

  it('создание пространства даёт reset создателю', async () => {
    const u = await mkUser(db);
    const c = new TestClient(services(db), u);
    const { cursor } = await c.bootstrap();
    await c.ok('space.create', {
      id: uuidv7(),
      name: 'N',
      rank: 'a0',
      memberId: uuidv7(),
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    });
    expect((await c.pull(cursor)).reset).toBe(true);
  });
});
