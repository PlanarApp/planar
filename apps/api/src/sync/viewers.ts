import { eq, getTableColumns } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { spaceMembers } from '../db/schema.js';
import { visibleEntities } from './registry.js';
import { tableOf } from './rows.js';

/**
 * Кто видит строку (те же правила, что bootstrap). null — сущность неизвестна/выключена,
 * строки нет или видимость `global` (для typing не нужна).
 */
export async function viewersOf(db: Db, entity: string, id: string): Promise<Set<string> | null> {
  const meta = (await visibleEntities(db))[entity];
  if (!meta) return null;
  const t = tableOf(entity);
  const c = getTableColumns(t);
  const [row] = (await db.select().from(t).where(eq(c.id, id)).limit(1)) as Record<
    string,
    unknown
  >[];
  if (!row) return null;
  const space = async (spaceId: string) =>
    new Set(
      (
        await db
          .select({ u: spaceMembers.userId })
          .from(spaceMembers)
          .where(eq(spaceMembers.spaceId, spaceId))
      ).map((r) => r.u),
    );
  const { scope } = meta;
  if (scope === 'user' || (scope === 'space|user' && row.userId != null))
    return new Set([row.userId as string]);
  if (scope === 'space') return space((entity === 'spaces' ? row.id : row.spaceId) as string);
  if (scope === 'space|user') return space(row.spaceId as string);
  if (scope === 'space|members' && meta.members) {
    if (row.spaceId != null) return space(row.spaceId as string);
    const { entity: me, key, via } = meta.members;
    const mt = tableOf(me);
    const mc = getTableColumns(mt);
    const rows = await db.select({ u: mc.userId }).from(mt).where(eq(mc[key], row[via]));
    return new Set(rows.map((r) => r.u as string));
  }
  return null;
}
