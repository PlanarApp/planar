import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { DATA_MODULE_IDS, uuidv7 } from '@planar/shared';
import { type Db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { PullService } from '../../src/sync/pull.service.js';
import { PushService } from '../../src/sync/push.service.js';
import { testDb, testDbUrl } from '../db.js';

export const NOW = '2026-10-22T10:00:00.000Z';

export const dbUrl = testDbUrl();

export const newDb = (): Db => testDb();

let n = 0;
/** User directly in the DB (until test/auth.ts from CR-3a appears). */
export async function mkUser(db: Db, role: 'owner' | 'admin' | 'member' | 'guest' = 'member') {
  const id = uuidv7();
  n += 1;
  await db
    .insert(schema.users)
    .values({ id, login: `u${n}_${id.slice(-8)}`, name: `User ${n}`, role, passwordHash: 'x' });
  return id;
}

/** Space with members {userId: role} directly in the DB; does not write changes. */
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
/** A project row directly in the DB (statuses and labels belong to a project, PJ-1); no statuses. All data modules are on (PJ-3) unless `modules` says otherwise. */
export async function mkProject(db: Db, spaceId: string, modules: string[] = [...DATA_MODULE_IDS]) {
  const id = uuidv7();
  await db
    .insert(schema.projects)
    .values({ id, spaceId, name: 'P', key: key(), rank: 'a0', modules });
  return id;
}
export const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** Sync client: its own clientId, a growing mutation id, services directly (no HTTP). */
export class TestClient {
  clientId = uuidv7();
  private n = 0;
  constructor(
    private svc: { push: PushService; pull: PullService },
    public userId: string,
  ) {}

  async push(name: string, args: unknown) {
    // PJ-1: a project needs its own statuses; tests that do not care get the 5 default ones
    const a = args as Record<string, unknown>;
    if (name === 'project.create' && !a.statusIds && !a.copyFrom)
      args = { ...a, statusIds: Array.from({ length: 5 }, () => uuidv7()) };
    if (name === 'project.create')
      statusesOf.set(a.id as string, (args as never as { statusIds: string[] }).statusIds ?? []);
    const { results } = await this.svc.push.push(this.userId, {
      clientId: this.clientId,
      mutations: [{ id: ++this.n, name, args }],
    });
    // PJ-3: data modules work per project; a project created in the tests has them all on (own client id: ids of this client are untouched)
    if (name === 'project.create' && results[0]?.ok)
      await this.svc.push.push(this.userId, {
        clientId: uuidv7(),
        mutations: DATA_MODULE_IDS.map((moduleId, i) => ({
          id: i + 1,
          name: 'project.setModule',
          args: { projectId: a.id, moduleId, enabled: true },
        })),
      });
    return results[0];
  }
  /** push waiting for success */
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

/** Adds a module to settings.enabled_modules directly in the DB (PLNRAPP-241: ai also needs the workspace switch). */
export async function workspaceModule(db: Db, id: string) {
  await db.execute(sql`insert into settings (id, value, updated_at) values ('enabled_modules', ${JSON.stringify([id])}::jsonb, now())
    on conflict (id) do update set value = case when settings.value ? ${id} then settings.value else settings.value || excluded.value end`);
}

/** Space (space.create by admin) + project; member/guest added, outsider — not. Workspace ai is on, like the data modules. */
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
  });
  await admin.ok('member.add', { id: uuidv7(), spaceId, userId: m, role: 'member' });
  await admin.ok('member.add', { id: uuidv7(), spaceId, userId: g, role: 'guest' });
  const projectId = uuidv7();
  await admin.ok('project.create', {
    id: projectId,
    spaceId,
    name: 'P',
    key: key(),
    rank: 'a0',
    statusIds,
  });
  await workspaceModule(db, 'ai');
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

/** project id -> ids of its 5 default statuses, for projects created through TestClient (PJ-1). */
const statusesOf = new Map<string, string[]>();

/** Makes a project created through TestClient the "main" one of the world: tests use w.projectId / w.statusIds. */
export const useProject = (w: World, projectId: string) => {
  w.projectId = projectId;
  w.statusIds = statusesOf.get(projectId)!;
};

/** Default status of another project: the same position among the 5 default statuses as w.statusIds. */
export const statusOf = (w: World, projectId: string, statusId: unknown) => {
  const own = statusesOf.get(projectId);
  const i = w.statusIds.indexOf(statusId as string);
  return own && projectId !== w.projectId && i >= 0 ? own[i] : statusId;
};

export const taskArgs = (w: World, over: Record<string, unknown> = {}) => {
  const a = {
    id: uuidv7(),
    projectId: w.projectId,
    statusId: w.statusIds[1],
    title: 'T',
    rank: 'a0',
    ...over,
  };
  return { ...a, statusId: statusOf(w, a.projectId as string, a.statusId) };
};
