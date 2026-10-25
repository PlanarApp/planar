import { and, eq, isNull, ne } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7 } from '@planar/shared';
import type { Db } from '../db/index.js';
import { settings, spaceMembers, spaces, users } from '../db/schema.js';
import { executeMutations } from '../sync/mutate.js';
import { ensureSystemUser } from '../users/system.js';

/** id настройки с корневым пространством — уровень «Воркспейс» (документы и чаты для всех). */
export const ROOT_SPACE = 'root_space';
const CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];

/**
 * Корневое пространство: создаётся при первом старте; все активные пользователи, кроме гостей, —
 * участники (владельцы и админы инстанса — админы пространства). Идемпотентно: вызывать при старте
 * и после создания или смены роли пользователя.
 */
export async function ensureRootSpace(db: Db): Promise<string> {
  const sys = await ensureSystemUser(db);
  const [row] = await db.select().from(settings).where(eq(settings.id, ROOT_SPACE));
  let id = typeof row?.value === 'string' ? row.value : undefined;
  if (id && !(await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, id))).length)
    id = undefined; // настройка осталась от удалённого пространства
  if (!id) {
    id = uuidv7();
    const [first] = await db.select({ rank: spaces.rank }).from(spaces).orderBy(spaces.rank).limit(1);
    await executeMutations(
      db,
      sys,
      [
        {
          name: 'space.create',
          args: {
            id,
            name: 'Общее',
            rank: generateKeyBetween(null, first?.rank ?? null),
            memberId: uuidv7(),
            statusIds: CATEGORIES.map(() => uuidv7()),
          },
        },
        { name: 'settings.set', args: { id: ROOT_SPACE, value: id } },
      ],
      undefined,
      undefined,
      { system: true },
    );
  }
  const people = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(isNull(users.deactivatedAt), ne(users.role, 'guest')));
  const have = new Set(
    (
      await db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(eq(spaceMembers.spaceId, id))
    ).map((m) => m.userId),
  );
  const add = people.filter((p) => !have.has(p.id));
  if (add.length)
    await executeMutations(
      db,
      sys,
      add.map((p) => ({
        name: 'member.add',
        args: {
          id: uuidv7(),
          spaceId: id,
          userId: p.id,
          role: p.role === 'owner' || p.role === 'admin' ? 'admin' : 'member',
        },
      })),
      undefined,
      undefined,
      { system: true },
    );
  return id;
}
