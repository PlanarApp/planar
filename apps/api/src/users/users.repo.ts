import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { fileUploads, users } from '../db/schema.js';
import { HttpError } from '../auth/errors.js';
import { ServerTx, type Q } from '../sync/server-tx.js';
import { toWire } from '../sync/rows.js';

// Все записи users — здесь, через ServerTx.asSystem: строка попадает в changes (без password_hash).

export type UserRow = typeof users.$inferSelect;

export const listUsers = (db: Db) => db.select().from(users).orderBy(asc(users.createdAt));

export const findUser = async (db: Db, id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0];

export const findUserByLogin = async (db: Db, login: string) =>
  (await db.select().from(users).where(eq(users.login, login)))[0];

export const hasFileUpload = async (db: Db, sha256: string, userId: string) =>
  (
    await db
      .select({ s: fileUploads.sha256 })
      .from(fileUploads)
      .where(and(eq(fileUploads.sha256, sha256), eq(fileUploads.userId, userId)))
  ).length > 0;

export async function insertUser(
  q: Q,
  v: { login: string; name: string; role: string; passwordHash: string; email?: string | null },
): Promise<UserRow> {
  try {
    const row = (await q.insert(users).values(v).returning())[0]!;
    await publish(q, row.id, row);
    return row;
  } catch (e) {
    const code = e as { code?: string; cause?: { code?: string } };
    if ((code.cause?.code ?? code.code) === '23505') {
      throw new HttpError(409, 'conflict', 'Логин уже занят');
    }
    throw e;
  }
}

export async function updateUser(
  q: Q,
  actorId: string,
  id: string,
  set: Partial<
    Pick<UserRow, 'name' | 'email' | 'role' | 'avatarFile' | 'deactivatedAt' | 'passwordHash'>
  >,
): Promise<UserRow> {
  const row = (
    await q
      .update(users)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning()
  )[0]!;
  await publish(q, actorId, row);
  return row;
}

/** Запись строки провода в changes; вызывать внутри транзакции. */
async function publish(q: Q, actorId: string, row: UserRow) {
  const tx = ServerTx.asSystem(q, { userId: actorId });
  await tx.put('users', toWire('users', row) as never, { passwordHash: row.passwordHash });
  await tx.finish();
}
