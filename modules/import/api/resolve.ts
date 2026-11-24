import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { HttpError, type AuthCtx, type CoreServices } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { NEW, type Mapping } from '../shared/index.js';
import type { Item } from './parse.js';

const TRANSLIT: Record<string, string> = {
  ...Object.fromEntries(
    [...'абвгдезийклмнопрстуфхцыэ'].map((c, i) => [c, 'abvgdezijklmnoprstufhcye'[i]!]),
  ),
  ё: 'e',
  ж: 'zh',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ю: 'yu',
  я: 'ya',
  ъ: '',
  ь: '',
};
const latin = (s: string) => [...s.toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('');

/** Login from a display name: `Andrey Z.` → `andrey.z`; taken — with a numeric suffix; the result goes into taken. */
export function loginFrom(name: string, taken: Set<string>): string {
  let base = latin(name)
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 28);
  if (base.length < 2) base = `user${base}`;
  let login = base;
  for (let n = 2; taken.has(login); n++) login = `${base}${n}`;
  taken.add(login);
  return login;
}

/** Project key `^[A-Z][A-Z0-9]{1,9}$` from the file key or the name; taken — with a numeric suffix. */
export function projectKey(key: string | undefined, name: string, taken: Set<string>): string {
  const clean = (s: string) =>
    latin(s)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^[0-9]+/, '');
  let base = clean(key ?? '') || clean(name);
  if (base.length < 2) base = `P${base}X`.slice(0, 2);
  base = base.slice(0, 10);
  let k = base;
  for (let n = 2; taken.has(k); n++) k = base.slice(0, 10 - String(n).length) + n;
  taken.add(k);
  return k;
}

/**
 * `new` in projectMap/userMap → creates projects in the import space and users (instance admin only),
 * new users become members of the space; a project from projectMap must be in that space and writable,
 * a user from userMap — a member of that space.
 * Returns the mapping with ids instead of `new`.
 */
export async function resolveNew(
  core: CoreServices,
  auth: AuthCtx,
  spaceId: string,
  mapping: Mapping,
  items: Item[],
): Promise<Mapping> {
  const q = <T>(s: ReturnType<typeof sql>) => core.db.execute(s).then((r) => r.rows as T[]);
  const projectMap = { ...mapping.projectMap };
  const userMap = { ...mapping.userMap };
  const newUsers = Object.keys(userMap).filter((k) => userMap[k] === NEW);
  // all checks before any creation: a refusal must leave nothing behind
  if (newUsers.length && auth.role !== 'owner' && auth.role !== 'admin')
    throw new HttpError(403, 'forbidden', 'Создавать пользователей может только администратор');

  // comments are written on behalf of the mapped author (system): only members of the import space
  for (const id of new Set(Object.values(userMap).filter((v) => v !== NEW))) {
    const ok = await q(sql`
      select 1 from space_members where space_id = ${spaceId} and user_id::text = ${id}`);
    if (!ok.length) throw new HttpError(400, 'invalid_request', 'userMap: пользователь не найден');
  }
  for (const id of new Set(Object.values(projectMap).filter((v) => v !== NEW))) {
    const ok = await q(sql`
      select 1 from projects p where p.id = ${id} and p.space_id = ${spaceId} and p.archived_at is null
        and project_role(${auth.userId}::uuid, p.id) in ('admin', 'member')`);
    if (!ok.length) throw new HttpError(400, 'invalid_request', 'projectMap: проект не найден');
  }
  const newProjects = Object.keys(projectMap).filter((k) => projectMap[k] === NEW);
  if (newProjects.length) {
    const keys = new Set(
      (await q<{ key: string }>(sql`select key from projects`)).map((r) => r.key),
    );
    const [last] = await q<{ m: string | null }>(
      sql`select max(rank collate "C") as m from projects where space_id = ${spaceId}`,
    );
    let rank = last?.m ?? null;
    const muts = newProjects.map((name) => {
      const id = uuidv7();
      projectMap[name] = id;
      rank = generateKeyBetween(rank, null);
      const key = items.find((it) => it.project === name)?.projectKey;
      return {
        name: 'project.create',
        args: {
          id,
          spaceId,
          name: name.slice(0, 200),
          key: projectKey(key, name, keys),
          rank,
          statusIds: Array.from({ length: 5 }, () => uuidv7()),
        },
      };
    });
    await core.execute(auth.userId, muts);
  }

  if (newUsers.length) {
    const taken = new Set(
      (await q<{ login: string }>(sql`select login from users`)).map((r) => r.login),
    );
    for (const name of newUsers)
      userMap[name] = await core.createUser(loginFrom(name, taken), name.slice(0, 200));
    // the import puts them on tasks of this space: members right away
    await core.execute(
      auth.userId,
      newUsers.map((name) => ({
        name: 'member.add',
        args: { id: uuidv7(), spaceId, userId: userMap[name], role: 'member' },
      })),
      { system: true },
    );
  }
  return {
    ...mapping,
    ...(mapping.projectMap && { projectMap }),
    ...(mapping.userMap && { userMap }),
  };
}
