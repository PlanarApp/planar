import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { fileUploads, users } from '../db/schema.js';
import { HttpError } from '../auth/errors.js';

// Все записи users — здесь: после слияния CR-4 переводятся на ServerTx (asSystem).

export type UserRow = typeof users.$inferSelect;
type Writer = Pick<Db, 'insert' | 'update'>;

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
  db: Writer,
  v: { login: string; name: string; role: string; passwordHash: string; email?: string | null },
): Promise<UserRow> {
  try {
    return (await db.insert(users).values(v).returning())[0]!;
  } catch (e) {
    const code = e as { code?: string; cause?: { code?: string } };
    if ((code.cause?.code ?? code.code) === '23505') {
      throw new HttpError(409, 'conflict', 'Логин уже занят');
    }
    throw e;
  }
}

export async function updateUser(
  db: Writer,
  id: string,
  set: Partial<
    Pick<UserRow, 'name' | 'email' | 'role' | 'avatarFile' | 'deactivatedAt' | 'passwordHash'>
  >,
): Promise<UserRow> {
  return (
    await db
      .update(users)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning()
  )[0]!;
}
