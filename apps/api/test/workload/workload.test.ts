import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { workloadCapacities } from '@planar/module-workload/api/schema';
import * as schema from '../../src/db/schema.js';
import { newDb, world, type World } from '../sync/helpers.js';

const db = newDb();
let w: World;
const rows = () =>
  db.select().from(workloadCapacities).where(eq(workloadCapacities.spaceId, w.spaceId));
const set = (userId: string, hoursPerWeek: number | null, id = uuidv7()) =>
  w.admin.push('workload.setCapacity', { id, spaceId: w.spaceId, userId, hoursPerWeek });

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['workload'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['workload'] } });
});
afterAll(() => db.$client.end());

describe('pt3: workload.setCapacity', () => {
  it('pt3: создаёт и обновляет строку (spaceId, userId) с другим id', async () => {
    const id = uuidv7();
    expect(await set(w.member.userId, 30, id)).toMatchObject({ ok: true });
    expect(await set(w.member.userId, 20)).toMatchObject({ ok: true });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id, hoursPerWeek: 20, updatedBy: w.admin.userId });
  });

  it('pt3: null удаляет строку', async () => {
    expect(await set(w.member.userId, null)).toMatchObject({ ok: true });
    expect(await rows()).toHaveLength(0);
  });

  it('pt3: не участник → invalid_args, не админ → forbidden', async () => {
    expect(JSON.stringify(await set(w.outsider.userId, 10))).toContain('invalid_args');
    const r = await w.member.push('workload.setCapacity', {
      id: uuidv7(),
      spaceId: w.spaceId,
      userId: w.member.userId,
      hoursPerWeek: 10,
    });
    expect(JSON.stringify(r)).toContain('forbidden');
  });
});
