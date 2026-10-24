import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { dashboardsBoards, dashboardsWidgets } from '@planar/module-dashboards/api/schema';
import * as schema from '../../src/db/schema.js';
import { newDb, world, type World } from '../sync/helpers.js';

const db = newDb();
let w: World;
const filter = { op: 'and', rules: [] };
const widget = (dashboardId: string, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  dashboardId,
  kind: 'number',
  config: { filter },
  x: 0,
  y: 0,
  w: 4,
  h: 2,
  ...over,
});
const rows = async (c: World['admin'], e: string) =>
  (((await c.bootstrap()).data as Record<string, { id: string }[]>)[e] ?? []).map((r) => r.id);

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['dashboards'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['dashboards'] } });
});
afterAll(() => db.$client.end());

describe('pt4: dashboards', () => {
  it('pt4: create — пространства (userId null) и личный (userId = автор)', async () => {
    const a = uuidv7();
    const b = uuidv7();
    await w.member.ok('dashboards.create', {
      id: a,
      name: 'Space',
      rank: 'a0',
      spaceId: w.spaceId,
    });
    await w.member.ok('dashboards.create', {
      id: b,
      name: 'Mine',
      rank: 'a1',
      spaceId: w.spaceId,
      personal: true,
    });
    const [ra] = await db.select().from(dashboardsBoards).where(eq(dashboardsBoards.id, a));
    const [rb] = await db.select().from(dashboardsBoards).where(eq(dashboardsBoards.id, b));
    expect(ra).toMatchObject({ spaceId: w.spaceId, userId: null, createdBy: w.member.userId });
    expect(rb).toMatchObject({ spaceId: w.spaceId, userId: w.member.userId });
    expect(await rows(w.admin, 'dashboardsBoards')).toContain(a);
  });

  it('pt4: чужой личный не виден в bootstrap и не правится', async () => {
    const b = uuidv7();
    await w.member.ok('dashboards.create', {
      id: b,
      name: 'Mine',
      rank: 'a1',
      spaceId: w.spaceId,
      personal: true,
    });
    const wid = widget(b);
    await w.member.ok('dashboards.widget.add', wid);
    expect(await rows(w.member, 'dashboardsBoards')).toContain(b);
    for (const c of [w.admin, w.outsider]) {
      expect(await rows(c, 'dashboardsBoards')).not.toContain(b);
      expect(await rows(c, 'dashboardsWidgets')).not.toContain(wid.id);
    }
    for (const [n, a] of [
      ['dashboards.update', { id: b, name: 'X' }],
      ['dashboards.delete', { id: b }],
      ['dashboards.widget.add', widget(b)],
      ['dashboards.widget.update', { id: wid.id, x: 1 }],
      ['dashboards.widget.remove', { id: wid.id }],
    ] as const)
      expect(await w.admin.push(n, a), n).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('pt4: delete удаляет виджеты (del в changes)', async () => {
    const b = uuidv7();
    await w.admin.ok('dashboards.create', { id: b, name: 'D', rank: 'a2', spaceId: w.spaceId });
    const ids = [widget(b), widget(b, { y: 2 })];
    for (const x of ids) await w.admin.ok('dashboards.widget.add', x);
    const cur = (await w.member.bootstrap()).cursor;
    await w.admin.ok('dashboards.delete', { id: b });
    const dels = (await w.member.pull(cur)).changes.filter((c) => c.op === 'del');
    expect(dels.map((d) => d.id).sort()).toEqual([b, ...ids.map((x) => x.id)].sort());
    expect(
      await db.select().from(dashboardsWidgets).where(eq(dashboardsWidgets.dashboardId, b)),
    ).toEqual([]);
  });

  it('pt4: неверный config и x+w>12 — invalid_args; update двигает', async () => {
    const b = uuidv7();
    await w.admin.ok('dashboards.create', { id: b, name: 'D', rank: 'a3', spaceId: w.spaceId });
    for (const over of [
      { x: 8, w: 6 },
      { kind: 'bars', config: { filter } },
      { kind: 'line', config: { filter, series: 'created', weeks: 3 } },
      { kind: 'list', config: { filter, sort: 'updatedAt', limit: 51 } },
      { config: {} },
    ])
      expect(
        await w.admin.push('dashboards.widget.add', widget(b, over)),
        JSON.stringify(over),
      ).toMatchObject({ ok: false, code: 'invalid_args' });
    const x = widget(b);
    await w.admin.ok('dashboards.widget.add', x);
    expect(await w.admin.push('dashboards.widget.update', { id: x.id, x: 10 })).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    expect(
      await w.admin.push('dashboards.widget.update', {
        id: x.id,
        config: { filter, groupBy: 'status' },
      }),
    ).toMatchObject({ ok: true });
    await w.admin.ok('dashboards.widget.update', { id: x.id, x: 8, w: 4, title: 'T' });
    const [r] = await db.select().from(dashboardsWidgets).where(eq(dashboardsWidgets.id, x.id));
    expect(r).toMatchObject({ x: 8, w: 4, title: 'T', spaceId: w.spaceId, userId: null });
  });
});
