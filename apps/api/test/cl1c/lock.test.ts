import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { doc, mkUser, newDb, services, TestClient, world, type World } from '../sync/helpers.js';

const db = newDb();
let w: World;

beforeAll(async () => {
  w = await world(db);
  const ia = new TestClient(services(db), await mkUser(db, 'admin'));
  await ia.ok('settings.set', { id: 'enabled_modules', value: ['docs', 'chat'] });
});
afterAll(() => db.$client.end());

describe('cl1c: advisory lock до чтения', () => {
  it('cl1c: параллельные docs.lock — один ok, один conflict', async () => {
    for (let i = 0; i < 5; i++) {
      const id = uuidv7();
      await w.member.ok('docs.page.create', { id, spaceId: w.spaceId, rank: 'a0' });
      const rs = await Promise.all([
        w.member.push('docs.lock', { pageId: id }),
        w.admin.push('docs.lock', { pageId: id }),
      ]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.filter((r) => !r.ok && r.code === 'conflict')).toHaveLength(1);
    }
  });

  it('cl1c: параллельные chat.message.send — все ok, seq различны', async () => {
    const ch = uuidv7();
    await w.member.ok('chat.channel.create', { id: ch, spaceId: w.spaceId, name: 'race' });
    const ids = Array.from({ length: 6 }, () => uuidv7());
    // у клиента mutation id последовательны — для параллели нужен клиент на каждый push
    const sv = services(db);
    const clients = ids.map((_, i) => new TestClient(sv, (i % 2 ? w.admin : w.member).userId));
    const rs = await Promise.all(
      ids.map((id, i) =>
        clients[i].push('chat.message.send', {
          id,
          channelId: ch,
          body: doc('hi'),
          readId: uuidv7(),
        }),
      ),
    );
    for (const r of rs) expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const seqs = (
      await db.execute(sql`select seq from chat_messages where channel_id = ${ch}`)
    ).rows.map((r) => Number(r.seq));
    expect(new Set(seqs).size).toBe(6);
  });

  it('cl1c: мутация только с чтением тоже берёт лок (повторно не берёт)', async () => {
    const id = uuidv7();
    await w.member.ok('docs.page.create', { id, spaceId: w.spaceId, rank: 'a0' });
    await w.member.ok('docs.lock', { pageId: id });
    await w.member.ok('docs.lock', { pageId: id });
  });
});
