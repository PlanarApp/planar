import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { newDb, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

const ids = (rows: Record<string, unknown>[] | undefined) => (rows ?? []).map((r) => r.id);

describe('PJ-4: вид узла', () => {
  it('PJ-4 общая строка вида видна всем участникам пространства, личная — только владельцу', async () => {
    const w = await world(db);
    const node = `p:${w.projectId}`;
    const mine = uuidv7();
    await w.member.ok('view.create', {
      id: mine,
      spaceId: w.spaceId,
      node,
      layout: 'list',
      personal: true,
      name: 'list',
      filter: {},
      config: {},
      rank: 'a0',
    });
    const dflt = () => ({
      id: uuidv7(),
      spaceId: w.spaceId,
      node,
      layout: 'list',
      filter: {},
      config: {},
    });
    const shared = dflt();
    await w.admin.ok('view.setNodeDefault', shared);
    const seen = async (c: typeof w.admin) => ids((await c.bootstrap()).data.savedViews);
    expect(await seen(w.member)).toEqual(expect.arrayContaining([mine, shared.id]));
    expect(await seen(w.admin)).toContain(shared.id);
    expect(await seen(w.admin)).not.toContain(mine);
    expect(await seen(w.guest)).toContain(shared.id);
    expect(await seen(w.outsider)).not.toContain(shared.id);
    expect(await w.guest.push('view.setNodeDefault', dflt())).toMatchObject({ ok: false });
  });
});
