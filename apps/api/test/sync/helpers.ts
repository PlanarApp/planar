import { expect } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { createDb, type Db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { PullService } from '../../src/sync/pull.service.js';
import { PushService } from '../../src/sync/push.service.js';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, inject } from 'vitest';
import { createDb as _c, migrate } from '../../src/db/index.js';

export const NOW = '2026-10-22T10:00:00.000Z';

// Своя база на файл: тесты sync создают пользователей и задачи, что ломает подсчёты других файлов (seed.test).
const adminUrl = new URL(inject('dbUrl'));
const name = `planar_t_${randomBytes(6).toString('hex')}`;
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`create database ${name}`);
export const dbUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return u.toString();
})();
{
  const m = _c(dbUrl);
  await migrate(m).finally(() => m.$client.end());
}
afterAll(async () => {
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
}, 60_000);

export const newDb = (): Db => createDb(dbUrl);

let n = 0;
/** Пользователь напрямую в БД (до появления test/auth.ts из CR-3a). */
export async function mkUser(db: Db, role: 'owner' | 'admin' | 'member' | 'guest' = 'member') {
  const id = uuidv7();
  n += 1;
  await db
    .insert(schema.users)
    .values({ id, login: `u${n}_${id.slice(-8)}`, name: `User ${n}`, role, passwordHash: 'x' });
  return id;
}

/** Пространство с участниками {userId: роль} напрямую в БД; changes не пишет. */
export async function mkSpace(
  db: Db,
  createdBy: string,
  members: Record<string, 'admin' | 'member' | 'guest'> = {},
) {
  const id = uuidv7();
  await db.insert(schema.spaces).values({ id, name: 'S', rank: 'a0', createdBy });
  for (const [userId, role] of Object.entries(members))
    await db.insert(schema.spaceMembers).values({ spaceId: id, userId, role });
  return id;
}

export const key = () =>
  `K${uuidv7()
    .slice(-8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'Z')}`;
export const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** Клиент синхронизации: свой clientId, растущий id мутаций, сервисы напрямую (без HTTP). */
export class TestClient {
  clientId = uuidv7();
  private n = 0;
  constructor(
    private svc: { push: PushService; pull: PullService },
    public userId: string,
  ) {}

  async push(name: string, args: unknown) {
    const { results } = await this.svc.push.push(this.userId, {
      clientId: this.clientId,
      mutations: [{ id: ++this.n, name, args }],
    });
    return results[0];
  }
  /** push с ожиданием успеха */
  async ok(name: string, args: unknown) {
    const r = await this.push(name, args);
    expect(r, `${name}: ${JSON.stringify(r)}`).toMatchObject({ ok: true });
  }
  bootstrap() {
    return this.svc.pull.bootstrap(this.userId, this.clientId);
  }
  pull(cursor: number) {
    return this.svc.pull.pull(this.userId, this.clientId, cursor);
  }
  get lastId() {
    return this.n;
  }
}

export function services(db: Db) {
  return { push: new PushService(db), pull: new PullService(db) };
}

export interface World {
  admin: TestClient;
  member: TestClient;
  guest: TestClient;
  outsider: TestClient;
  spaceId: string;
  statusIds: string[];
  projectId: string;
}

/** Пространство (space.create от admin) + проект; member/guest добавлены, outsider — нет. */
export async function world(db: Db): Promise<World> {
  const s = services(db);
  const [a, m, g, o] = await Promise.all(
    (['member', 'member', 'guest', 'member'] as const).map((r) => mkUser(db, r)),
  );
  const admin = new TestClient(s, a);
  const spaceId = uuidv7();
  const statusIds = Array.from({ length: 5 }, () => uuidv7());
  await admin.ok('space.create', {
    id: spaceId,
    name: 'W',
    rank: 'a0',
    memberId: uuidv7(),
    statusIds,
  });
  await admin.ok('member.add', { id: uuidv7(), spaceId, userId: m, role: 'member' });
  await admin.ok('member.add', { id: uuidv7(), spaceId, userId: g, role: 'guest' });
  const projectId = uuidv7();
  await admin.ok('project.create', { id: projectId, spaceId, name: 'P', key: key(), rank: 'a0' });
  return {
    admin,
    member: new TestClient(s, m),
    guest: new TestClient(s, g),
    outsider: new TestClient(s, o),
    spaceId,
    statusIds,
    projectId,
  };
}

export const taskArgs = (w: World, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  projectId: w.projectId,
  statusId: w.statusIds[1],
  title: 'T',
  rank: 'a0',
  ...over,
});
