// PJ-17: a client with a replica from before an update (cursor before a migration's global _reset) catches up by itself
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newDb, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

describe('pj17: reset после миграции', () => {
  it('pj17: глобальный _reset из миграции -> reset всем, bootstrap = то, что видит новый клиент', async () => {
    const w = await world(db);
    const old = await w.member.bootstrap();
    await db.execute(
      sql`INSERT INTO "changes" (entity, id, op) VALUES ('_reset', 'pj17-test', 'put')`,
    );
    for (const c of [w.member, w.admin, w.guest, w.outsider]) {
      const r = await c.pull(old.cursor);
      expect(r).toMatchObject({ reset: true, changes: [] });
    }
    const fresh = await w.member.bootstrap();
    expect(fresh.cursor).toBeGreaterThan(old.cursor);
    expect(fresh.data.projects!.map((p) => p.id)).toContain(w.projectId);
    expect(fresh.data.statuses!.length).toBeGreaterThan(0);
    // после bootstrap старый клиент в штатном режиме: чистый pull
    expect(await w.member.pull(fresh.cursor)).toMatchObject({ changes: [] });
  });
});
