// Merging tasks leaves a trace in the activity of both: the source and the target.
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import * as s from '../../src/db/schema.js';
import { newDb, taskArgs, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

describe('task.merge: история', () => {
  it('запись merged_into у источника и merged_from у цели, с названием другой задачи', async () => {
    const w = await world(db);
    const a = { ...taskArgs(w), title: 'Целевая' };
    const b = { ...taskArgs(w), title: 'Источник' };
    await w.member.ok('task.create', a);
    await w.member.ok('task.create', b);
    await w.member.ok('task.merge', { ids: [b.id], targetId: a.id, linkIds: [uuidv7()] });
    const of = async (id: string) =>
      (await db.select().from(s.activity).where(eq(s.activity.taskId, id))).filter((r) =>
        r.kind.startsWith('merged_'),
      );
    expect(await of(b.id)).toMatchObject([
      { kind: 'merged_into', changes: { taskId: a.id, title: 'Целевая' } },
    ]);
    expect(await of(a.id)).toMatchObject([
      { kind: 'merged_from', changes: { taskId: b.id, title: 'Источник' } },
    ]);
  });
});
