// PJ-14: project.create with modules (C-mutators v13)
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import { dbUrl, key, newDb, world } from '../sync/helpers.js';
import type { World } from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;

beforeAll(async () => {
  w = await world(db);
});
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const create = (modules: string[]) => {
  const id = uuidv7();
  // a plain member creates it: no admin rights needed
  return {
    id,
    res: w.member.push('project.create', {
      id,
      spaceId: w.spaceId,
      name: 'P14',
      key: key(),
      rank: 'a0',
      modules,
    }),
  };
};

describe('PJ-14: project.create modules', () => {
  it('PJ-14 доступные модули сохраняются в проекте', async () => {
    const { id, res } = create(['time', 'docs']);
    expect(await res).toMatchObject({ ok: true });
    const row = (await db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0]!;
    expect(row.modules).toEqual(['time', 'docs']);
  });

  it('PJ-14 недоступный модуль → invalid_args, проект не создан', async () => {
    const mod = installed.find((m) => m.api.id === 'time')!;
    const orig = mod.api.unavailable;
    mod.api.unavailable = async () => 'smtp_not_configured';
    try {
      const { id, res } = create(['time']);
      expect(await res).toMatchObject({ ok: false, code: 'invalid_args' });
      expect(await db.select().from(schema.projects).where(eq(schema.projects.id, id))).toEqual([]);
    } finally {
      mod.api.unavailable = orig;
    }
  });
});
