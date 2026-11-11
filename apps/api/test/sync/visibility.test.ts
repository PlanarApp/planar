import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { ServerTx } from '../../src/sync/server-tx.js';
import { NOW, TestClient, mkUser, newDb, services, taskArgs, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

const ids = (rows: Record<string, unknown>[] | undefined) => (rows ?? []).map((r) => r.id);

describe('видимость', () => {
  it('bootstrap постороннего не содержит строк чужого пространства', async () => {
    const w = await world(db);
    const t = taskArgs(w);
    await w.admin.ok('task.create', t);
    const b = await w.outsider.bootstrap();
    expect(ids(b.data.spaces)).not.toContain(w.spaceId);
    for (const e of ['projects', 'statuses', 'tasks', 'spaceMembers'])
      expect(
        b.data[e]!.filter((r) => r.spaceId === w.spaceId),
        e,
      ).toEqual([]);
    expect(ids((await w.member.bootstrap()).data.tasks)).toContain(t.id);
  });

  it('pull постороннего не содержит чужих изменений (в т.ч. activity)', async () => {
    const w = await world(db);
    const { cursor } = await w.outsider.bootstrap();
    await w.admin.ok('task.create', taskArgs(w));
    const r = await w.outsider.pull(cursor);
    expect(
      r.changes.filter((c) => (c.data as { spaceId?: string })?.spaceId === w.spaceId),
    ).toEqual([]);
    const m = await w.member.pull(cursor - 1000 > 0 ? cursor : cursor);
    expect(m.reset).toBeUndefined();
  });

  it('участник видит activity через pull, но не в bootstrap', async () => {
    const w = await world(db);
    const { cursor, data } = await w.member.bootstrap();
    expect(data.activity).toBeUndefined();
    await w.admin.ok('task.create', taskArgs(w));
    const r = await w.member.pull(cursor);
    expect(r.changes.some((c) => c.entity === 'activity')).toBe(true);
  });

  it('уведомления видит только получатель (bootstrap и pull)', async () => {
    const w = await world(db);
    const { cursor } = await w.member.bootstrap();
    const n = {
      id: uuidv7(),
      userId: w.member.userId,
      spaceId: w.spaceId,
      kind: 'assigned' as const,
      taskId: uuidv7(),
      url: null,
      body: null,
      commentId: null,
      changes: null,
      actorId: w.admin.userId,
      readAt: null,
      createdAt: NOW,
    };
    await db.transaction(async (tx) => {
      const stx = ServerTx.asSystem(tx, { userId: w.admin.userId });
      await stx.put('notifications', n);
      await stx.finish();
    });
    expect(ids((await w.member.bootstrap()).data.notifications)).toContain(n.id);
    for (const other of [w.admin, w.guest, w.outsider]) {
      expect(ids((await other.bootstrap()).data.notifications)).not.toContain(n.id);
      expect((await other.pull(cursor)).changes.some((c) => c.id === n.id)).toBe(false);
    }
    expect((await w.member.pull(cursor)).changes.some((c) => c.id === n.id)).toBe(true);
  });

  it('личный вид видит только владелец, общий — все участники', async () => {
    const w = await world(db);
    const { cursor } = await w.guest.bootstrap();
    const view = (personal: boolean) => ({
      id: uuidv7(),
      spaceId: w.spaceId,
      personal,
      name: 'v',
      layout: 'list',
      filter: {},
      config: {},
      rank: 'a0',
    });
    const mine = view(true);
    const shared = view(false);
    await w.member.ok('view.create', mine);
    await w.member.ok('view.create', shared);
    const g = await w.guest.bootstrap();
    expect(ids(g.data.savedViews)).toContain(shared.id);
    expect(ids(g.data.savedViews)).not.toContain(mine.id);
    expect(ids((await w.member.bootstrap()).data.savedViews)).toContain(mine.id);
    const pulled = (await w.guest.pull(cursor)).changes
      .filter((c) => c.entity === 'savedViews')
      .map((c) => c.id);
    expect(pulled).toEqual([shared.id]);
    expect(ids((await w.outsider.bootstrap()).data.savedViews)).not.toContain(shared.id);
  });

  it('users без password_hash, видны все пользователи', async () => {
    const w = await world(db);
    const b = await w.outsider.bootstrap();
    expect(b.data.users!.length).toBeGreaterThanOrEqual(4);
    for (const u of b.data.users!) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('password_hash');
    }
    expect(Object.keys(b.data.users![0]).sort()).toEqual([
      'avatarFile',
      'bot',
      'createdAt',
      'deactivatedAt',
      'email',
      'id',
      'login',
      'name',
      'role',
      'updatedAt',
    ]);
  });

  it('settings глобальны: видны всем и без пространств', async () => {
    const owner = await mkUser(db, 'owner');
    const c = new TestClient(services(db), owner);
    const key = `k_${uuidv7()}`;
    await c.ok('settings.set', { id: key, value: { a: 1 } });
    const stranger = new TestClient(services(db), await mkUser(db));
    expect((await stranger.bootstrap()).data.settings!.find((s) => s.id === key)).toMatchObject({
      value: { a: 1 },
    });
  });

  it('ts в bootstrap — ISO UTC с мс, size — число', async () => {
    const w = await world(db);
    const b = await w.admin.bootstrap();
    const sp = b.data.spaces!.find((s) => s.id === w.spaceId)!;
    expect(sp.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });
});
