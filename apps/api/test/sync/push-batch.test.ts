// PLNRAPP-253: push in transactions of up to PUSH_BATCH mutations; hooks and reads without extra queries.
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { uuidv7 } from '@planar/shared';
import { changes, clientMutations, tasks } from '../../src/db/schema.js';
import { changesPurge } from '../../src/jobs/changes.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { PUSH_BATCH } from '../../src/sync/push.service.js';
import { newDb, services, taskArgs, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

/** SQL texts of the queries fn sends. */
async function queries(fn: () => Promise<unknown>): Promise<string[]> {
  const log: string[] = [];
  const orig = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...a: unknown[]) {
    const q = a[0] as string | { text?: string };
    log.push(typeof q === 'string' ? q : (q?.text ?? ''));
    return orig.apply(this, a as never);
  } as typeof orig;
  try {
    await fn();
  } finally {
    pg.Client.prototype.query = orig;
  }
  return log;
}

describe('push пачками', () => {
  it('отказ в середине пачки откатывает только свою мутацию, пачки идут дальше', async () => {
    const w = await world(db);
    const args = Array.from({ length: PUSH_BATCH + 2 }, () => taskArgs(w));
    const bad = 4;
    const mutations = args.map((a, i) => ({
      id: i + 1,
      name: 'task.create',
      // an assignee who does not exist: invalid_args after the task row is written
      args: i === bad ? { ...a, assignees: [{ id: uuidv7(), userId: uuidv7() }] } : a,
    }));
    const clientId = uuidv7();
    const push = () => services(db).push.push(w.admin.userId, { clientId, mutations });
    const { results } = await push();
    expect(results.map((r) => r.id)).toEqual(mutations.map((m) => m.id));
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ id: bad + 1, code: 'invalid_args' }),
    ]);
    const ids = args.map((a) => a.id);
    const rows = await db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.id, ids));
    expect(rows.map((r) => r.id).sort()).toEqual(ids.filter((_, i) => i !== bad).sort());
    expect(await db.select().from(changes).where(eq(changes.id, ids[bad]))).toHaveLength(0);
    const [cm] = await db
      .select()
      .from(clientMutations)
      .where(eq(clientMutations.clientId, clientId));
    expect(cm.lastMutationId).toBe(mutations.length);
    // a repeat (the answer was lost): the same answers — the refusal stays a refusal, nothing new is written
    expect((await push()).results).toEqual(results);
    expect(await db.select().from(tasks).where(inArray(tasks.id, ids))).toHaveLength(
      ids.length - 1,
    );
  });

  it('task.update: строка читается один раз, хуки без запросов не открывают savepoint', async () => {
    const w = await world(db);
    const a = taskArgs(w);
    await w.admin.ok('task.create', a);
    const log = await queries(() => w.admin.ok('task.update', { id: a.id, title: 'новое' }));
    const reads = log.filter((q) => /^select .* from "tasks" where "tasks"."id"/.test(q));
    expect(reads).toHaveLength(1);
    // automations reads its rules: one savepoint; before PLNRAPP-253 there was one per hooked module
    expect(log.filter((q) => q.startsWith('savepoint')).length).toBeLessThanOrEqual(1);
    expect(log.length).toBeLessThanOrEqual(22);
  });
});

describe('обрезка журнала changes', () => {
  it('удаляет строки старше 30 дней, последнюю оставляет', async () => {
    const w = await world(db);
    await w.admin.ok('task.create', taskArgs(w));
    await db.$client.query(`update changes set created_at = now() - interval '31 days'`);
    const [{ max }] = (await db.$client.query('select max(seq)::int max from changes')).rows;
    const fresh = taskArgs(w);
    await w.admin.ok('task.create', fresh);
    await changesPurge.handler(undefined, { db } as unknown as JobApi);
    const left = (await db.$client.query('select seq::int, id from changes order by seq')).rows;
    expect(left.every((r) => r.seq > max)).toBe(true);
    expect(left.some((r) => r.id === fresh.id)).toBe(true);

    // everything old: the newest row stays
    await db.$client.query(`update changes set created_at = now() - interval '31 days'`);
    await changesPurge.handler(undefined, { db } as unknown as JobApi);
    const last = (await db.$client.query('select seq::int from changes')).rows;
    expect(last).toEqual([{ seq: left.at(-1)!.seq }]);
  });
});
