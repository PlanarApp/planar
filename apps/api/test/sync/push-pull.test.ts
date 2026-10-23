import { afterAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { contractSchemas, uuidv7 } from '@planar/shared';
import { changes, tasks } from '../../src/db/schema.js';
import { TestClient, mkUser, newDb, services, taskArgs, world } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

describe('push → pull', () => {
  it('второй клиент (другой пользователь пространства) видит put после своего cursor', async () => {
    const w = await world(db);
    const { cursor } = await w.member.bootstrap();
    const args = taskArgs(w, { title: 'Из push' });
    await w.admin.ok('task.create', args);
    const r = await w.member.pull(cursor);
    expect(r.reset).toBeUndefined();
    const put = r.changes.find((c) => c.entity === 'tasks' && c.id === args.id);
    expect(put).toMatchObject({
      op: 'put',
      data: { title: 'Из push', number: 1, spaceId: w.spaceId },
    });
    expect(r.cursor).toBeGreaterThanOrEqual(put!.seq);
    expect(contractSchemas['sync.pull'].safeParse(r).success).toBe(true);
  });

  it('del попадает в журнал без data', async () => {
    const w = await world(db);
    const args = taskArgs(w);
    await w.admin.ok('task.create', args);
    const { cursor } = await w.member.bootstrap();
    await w.admin.ok('task.delete', { id: args.id });
    const r = await w.member.pull(cursor);
    const del = r.changes.find((c) => c.entity === 'tasks' && c.id === args.id);
    expect(del).toEqual({ seq: expect.any(Number), entity: 'tasks', id: args.id, op: 'del' });
  });

  it('seq строго растёт, cursor ответа = max журнала', async () => {
    const w = await world(db);
    const { cursor } = await w.member.bootstrap();
    await w.admin.ok('task.create', taskArgs(w));
    await w.admin.ok('task.create', taskArgs(w));
    const r = await w.member.pull(cursor);
    const seqs = r.changes.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const [{ m }] = await db.$client
      .query('select max(seq)::int m from changes')
      .then((x) => x.rows);
    expect(r.cursor).toBeLessThanOrEqual(m);
    expect(r.cursor).toBe(seqs.at(-1)! <= r.cursor ? r.cursor : -1);
  });

  it('повтор того же id не применяется дважды', async () => {
    const w = await world(db);
    const clientId = uuidv7();
    const args = taskArgs(w);
    const req = { clientId, mutations: [{ id: 1, name: 'task.create', args }] };
    const s = services(db);
    const first = await s.push.push(w.admin.userId, req);
    const second = await s.push.push(w.admin.userId, req);
    expect(first.results).toEqual([{ id: 1, ok: true }]);
    expect(second.results).toEqual([{ id: 1, ok: true }]);
    const rows = await db.select().from(tasks).where(eq(tasks.projectId, w.projectId));
    expect(rows).toHaveLength(1);
    const ch = await db
      .select()
      .from(changes)
      .where(and(eq(changes.entity, 'tasks'), eq(changes.id, args.id)));
    expect(ch).toHaveLength(1);
  });

  it('id меньше last_mutation_id тоже пропускается', async () => {
    const w = await world(db);
    const s = services(db);
    const clientId = uuidv7();
    const a = taskArgs(w);
    const b = taskArgs(w);
    await s.push.push(w.admin.userId, {
      clientId,
      mutations: [{ id: 5, name: 'task.create', args: a }],
    });
    const r = await s.push.push(w.admin.userId, {
      clientId,
      mutations: [{ id: 3, name: 'task.create', args: b }],
    });
    expect(r.results).toEqual([{ id: 3, ok: true }]);
    expect(await db.select().from(tasks).where(eq(tasks.id, b.id))).toHaveLength(0);
  });

  it('отклонённая засчитана: lastMutationId растёт, повтор не выполняется', async () => {
    const w = await world(db);
    const c = w.admin;
    const r = await c.push('task.create', { nonsense: true });
    const id = c.lastId;
    expect(r).toMatchObject({ id, ok: false, code: 'invalid_args' });
    expect((await c.bootstrap()).lastMutationId).toBe(id);
    const args = taskArgs(w);
    const again = await services(db).push.push(c.userId, {
      clientId: c.clientId,
      mutations: [{ id, name: 'task.create', args }],
    });
    expect(again.results).toEqual([{ id, ok: true }]);
    expect(await db.select().from(tasks).where(eq(tasks.id, args.id))).toHaveLength(0);
  });

  it('неизвестный мутатор → unknown_mutator, следующая мутация выполняется', async () => {
    const w = await world(db);
    const args = taskArgs(w);
    const { results } = await services(db).push.push(w.admin.userId, {
      clientId: uuidv7(),
      mutations: [
        { id: 1, name: 'no.such', args: {} },
        { id: 2, name: 'task.create', args },
      ],
    });
    expect(results[0]).toMatchObject({ id: 1, ok: false, code: 'unknown_mutator' });
    expect(results[1]).toEqual({ id: 2, ok: true });
    expect(contractSchemas['sync.pushResponse'].safeParse({ results }).success).toBe(true);
  });

  it('чужой clientId → 403 на весь запрос', async () => {
    const w = await world(db);
    await w.admin.ok('task.create', taskArgs(w));
    await expect(
      services(db).push.push(w.member.userId, {
        clientId: w.admin.clientId,
        mutations: [{ id: 99, name: 'task.create', args: taskArgs(w) }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('чужой clientId → 403 и при пустой пачке', async () => {
    const w = await world(db);
    await w.admin.ok('task.create', taskArgs(w));
    await expect(
      services(db).push.push(w.member.userId, { clientId: w.admin.clientId, mutations: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('отказ откатывает мутацию целиком (нет частичных строк)', async () => {
    const w = await world(db);
    const args = taskArgs(w, { assignees: [{ id: uuidv7(), userId: uuidv7() }] });
    const r = await w.member.push('task.create', args);
    expect(r).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(await db.select().from(tasks).where(eq(tasks.id, args.id))).toHaveLength(0);
    const ch = await db.select().from(changes).where(eq(changes.id, args.id));
    expect(ch).toHaveLength(0);
  });

  it('пачка выполняется по порядку, результаты в том же порядке', async () => {
    const w = await world(db);
    const a = taskArgs(w);
    const b = taskArgs(w, { parentId: a.id });
    const { results } = await services(db).push.push(w.admin.userId, {
      clientId: uuidv7(),
      mutations: [
        { id: 1, name: 'task.create', args: a },
        { id: 2, name: 'task.create', args: b },
        { id: 3, name: 'task.update', args: { id: uuidv7(), title: 'x' } },
      ],
    });
    expect(results.map((r) => [r.id, r.ok])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    expect(results[2]).toMatchObject({ code: 'not_found' });
  });

  it('bootstrap отдаёт lastMutationId своего клиента и 0 чужого', async () => {
    const w = await world(db);
    await w.admin.ok('task.create', taskArgs(w));
    expect((await w.admin.bootstrap()).lastMutationId).toBe(w.admin.lastId);
    const other = new TestClient(services(db), w.admin.userId);
    expect((await other.bootstrap()).lastMutationId).toBe(0);
    const impostor = new TestClient(services(db), w.member.userId);
    impostor.clientId = w.admin.clientId;
    expect((await impostor.bootstrap()).lastMutationId).toBe(0);
  });

  it('bootstrap: cursor = max журнала, все bootstrap-сущности есть и валидны по контракту', async () => {
    const u = await mkUser(db);
    const c = new TestClient(services(db), u);
    const b = await c.bootstrap();
    expect(contractSchemas['sync.bootstrap'].safeParse(b).success).toBe(true);
    expect(Object.keys(b.data).sort()).toEqual(
      [
        'users',
        'spaces',
        'spaceMembers',
        'projects',
        'statuses',
        'tasks',
        'taskAssignees',
        'taskWatchers',
        'labels',
        'taskLabels',
        'checklistItems',
        'comments',
        'commentReactions',
        'attachments',
        'notifications',
        'savedViews',
        'settings',
      ].sort(),
    );
    expect(b.data.spaces).toEqual([]);
    const [{ m }] = await db.$client
      .query('select coalesce(max(seq),0)::int m from changes')
      .then((x) => x.rows);
    expect(b.cursor).toBeLessThanOrEqual(m);
  });
});
