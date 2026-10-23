import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { MutatorError, uuidv7, type Row } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import { ServerTx } from '../../src/sync/server-tx.js';
import { dbUrl, NOW, key, mkSpace, mkUser, newDb } from './helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

/** Выполняет fn в транзакции с откатом — журнал и данные не остаются. */
async function inTx<T>(
  fn: (q: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    return await fn(drizzle({ client, schema, casing: 'snake_case' }));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof MutatorError ? e.code : `throw:${(e as Error).message}`;
  }
  return 'ok';
};

const label = (spaceId: string): Row<'labels'> => ({
  id: uuidv7(),
  spaceId,
  name: 'l',
  color: '#000',
  createdAt: NOW,
  updatedAt: NOW,
});

const project = (spaceId: string, over: Partial<Row<'projects'>> = {}): Row<'projects'> => ({
  id: uuidv7(),
  spaceId,
  name: 'P',
  key: key(),
  description: null,
  color: null,
  icon: null,
  leadId: null,
  rank: 'a0',
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const chg = (q: Parameters<Parameters<typeof inTx>[0]>[0], id: string) =>
  q
    .select()
    .from(schema.changes)
    .where(sql`${schema.changes.id} = ${id}`);

describe('ServerTx: права', () => {
  async function setup(role: 'admin' | 'member' | 'guest' | null) {
    const owner = await mkUser(db);
    const user = await mkUser(db, 'member');
    const spaceId = await mkSpace(db, owner, role ? { [user]: role } : {});
    return { user, spaceId };
  }

  it.each([
    ['admin', 'ok'],
    ['member', 'ok'],
    ['guest', 'forbidden'],
    [null, 'forbidden'],
  ] as const)('projects (write: member): роль %s → %s', async (role, want) => {
    const { user, spaceId } = await setup(role);
    await inTx(async (q) => {
      expect(await code(new ServerTx(q, { userId: user }).put('projects', project(spaceId)))).toBe(
        want,
      );
    });
  });

  it.each([
    ['admin', 'ok'],
    ['member', 'forbidden'],
    ['guest', 'forbidden'],
  ] as const)('statuses (write: admin): роль %s → %s', async (role, want) => {
    const { user, spaceId } = await setup(role);
    const st: Row<'statuses'> = {
      id: uuidv7(),
      spaceId,
      name: 's',
      category: 'todo',
      color: '#000',
      rank: 'a0',
      createdAt: NOW,
      updatedAt: NOW,
    };
    await inTx(async (q) => {
      expect(await code(new ServerTx(q, { userId: user }).put('statuses', st))).toBe(want);
    });
  });

  it('guest пишет только comments/taskWatchers (write: guest), не labels', async () => {
    const { user, spaceId } = await setup('guest');
    await inTx(async (q) => {
      const tx = new ServerTx(q, { userId: user });
      expect(await code(tx.put('labels', label(spaceId)))).toBe('forbidden');
    });
  });

  it('замена строки проверяется и по старой строке', async () => {
    const owner = await mkUser(db);
    const user = await mkUser(db);
    const a = await mkSpace(db, owner, { [user]: 'member' });
    const b = await mkSpace(db, owner, {});
    await inTx(async (q) => {
      const sys = ServerTx.asSystem(q, { userId: owner });
      const l = label(b);
      await sys.put('labels', l);
      const tx = new ServerTx(q, { userId: user });
      // user — member только в a: перенос строки из b в a запрещён (старая строка в b)
      expect(await code(tx.put('labels', { ...l, spaceId: a }))).toBe('invalid_args');
      expect(await code(tx.put('labels', { ...l, name: 'x' }))).toBe('forbidden');
    });
  });

  it('patch с другим spaceId → invalid_args', async () => {
    const { user, spaceId } = await setup('admin');
    await inTx(async (q) => {
      const tx = new ServerTx(q, { userId: user });
      const l = label(spaceId);
      await tx.put('labels', l);
      expect(await code(tx.patch('labels', l.id, { spaceId: uuidv7() }))).toBe('invalid_args');
    });
  });

  it('users — write: server → forbidden для мутатора, settings — только admin инстанса', async () => {
    const member = await mkUser(db, 'member');
    const admin = await mkUser(db, 'admin');
    await inTx(async (q) => {
      const tx = new ServerTx(q, { userId: member });
      expect(await code(tx.patch('users', member, { name: 'x' }))).toBe('forbidden');
      const s: Row<'settings'> = { id: `k${uuidv7()}`, value: 1, updatedAt: NOW };
      expect(await code(tx.put('settings', s))).toBe('forbidden');
      expect(await code(new ServerTx(q, { userId: admin }).put('settings', s))).toBe('ok');
    });
  });

  it('activity и прочие server-сущности недоступны мутаторам, системе — можно', async () => {
    const { user, spaceId } = await setup('admin');
    const row: Row<'activity'> = {
      id: uuidv7(),
      spaceId,
      taskId: uuidv7(),
      actorId: user,
      kind: 'created',
      changes: {},
      viaTokenId: null,
      createdAt: NOW,
    };
    await inTx(async (q) => {
      expect(await code(new ServerTx(q, { userId: user }).put('activity', row))).toBe('forbidden');
      expect(await code(ServerTx.asSystem(q, { userId: user }).put('activity', row))).toBe('ok');
    });
  });

  it('notifications (self): только свои', async () => {
    const { user, spaceId } = await setup('member');
    const other = await mkUser(db);
    const n = (userId: string): Row<'notifications'> => ({
      id: uuidv7(),
      userId,
      spaceId,
      kind: 'assigned',
      taskId: uuidv7(),
      commentId: null,
      actorId: user,
      readAt: null,
      createdAt: NOW,
    });
    await inTx(async (q) => {
      const tx = new ServerTx(q, { userId: user });
      expect(await code(tx.put('notifications', n(user)))).toBe('ok');
      expect(await code(tx.put('notifications', n(other)))).toBe('forbidden');
    });
  });

  it('savedViews: личный вид чужого пользователя → forbidden, общий — member', async () => {
    const { user, spaceId } = await setup('member');
    const other = await mkUser(db);
    const v = (userId: string | null): Row<'savedViews'> => ({
      id: uuidv7(),
      spaceId,
      userId,
      createdBy: user,
      name: 'v',
      layout: 'list',
      filter: {},
      config: {},
      rank: 'a0',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await inTx(async (q) => {
      const tx = new ServerTx(q, { userId: user });
      expect(await code(tx.put('savedViews', v(null)))).toBe('ok');
      expect(await code(tx.put('savedViews', v(user)))).toBe('ok');
      expect(await code(tx.put('savedViews', v(other)))).toBe('forbidden');
    });
  });

  it('новое пространство: не guest; создатель сам добавляет себя и пишет в него', async () => {
    const member = await mkUser(db, 'member');
    const guest = await mkUser(db, 'guest');
    const sp = (createdBy: string): Row<'spaces'> => ({
      id: uuidv7(),
      name: 'N',
      description: null,
      color: null,
      icon: null,
      rank: 'a0',
      createdBy,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await inTx(async (q) => {
      expect(await code(new ServerTx(q, { userId: guest }).put('spaces', sp(guest)))).toBe(
        'forbidden',
      );
      const tx = new ServerTx(q, { userId: member });
      const s = sp(member);
      expect(await code(tx.put('spaces', s))).toBe('ok');
      const m: Row<'spaceMembers'> = {
        id: uuidv7(),
        spaceId: s.id,
        userId: member,
        role: 'admin',
        createdAt: NOW,
        updatedAt: NOW,
      };
      expect(await code(tx.put('spaceMembers', m))).toBe('ok');
      expect(await code(tx.put('labels', label(s.id)))).toBe('ok');
      // чужое существующее пространство тем же tx создать нельзя
      const foreign = await mkSpace(db, member, {});
      expect(await code(tx.put('labels', label(foreign)))).toBe('forbidden');
    });
  });

  it('роль кешируется на мутацию: удаление своего членства не лишает прав', async () => {
    const { user, spaceId } = await setup('admin');
    await inTx(async (q) => {
      const tx = new ServerTx(q, { userId: user });
      const l = label(spaceId);
      await tx.put('labels', l);
      const [m] = await tx.scan('spaceMembers', { index: 'userId', eq: user });
      await tx.del('spaceMembers', m.id);
      expect(await code(tx.del('labels', l.id))).toBe('ok');
    });
  });

  it('attachments: нужен file_uploads пользователя или файл уже приложен в пространстве', async () => {
    const { user, spaceId } = await setup('member');
    const other = await mkUser(db);
    const taskRow = async (q: Parameters<Parameters<typeof inTx>[0]>[0]) => {
      const sys = ServerTx.asSystem(q, { userId: user });
      const st = {
        id: uuidv7(),
        spaceId,
        name: 's',
        category: 'todo' as const,
        color: '#000',
        rank: 'a0',
        createdAt: NOW,
        updatedAt: NOW,
      };
      await sys.put('statuses', st);
      const p = project(spaceId);
      await sys.put('projects', p);
      const t: Row<'tasks'> = {
        id: uuidv7(),
        spaceId,
        projectId: p.id,
        number: null,
        parentId: null,
        statusId: st.id,
        title: 't',
        description: null,
        priority: 0,
        rank: 'a0',
        dueDate: null,
        startDate: null,
        createdBy: user,
        completedAt: null,
        fields: {},
        createdAt: NOW,
        updatedAt: NOW,
      };
      await sys.put('tasks', t);
      return t;
    };
    const sha = uuidv7().replaceAll('-', '').padEnd(64, '0');
    await inTx(async (q) => {
      const t = await taskRow(q);
      const att: Row<'attachments'> = {
        id: uuidv7(),
        spaceId,
        taskId: t.id,
        commentId: null,
        fileSha256: sha,
        name: 'a',
        mime: 'x/y',
        size: 5_000_000_000,
        width: null,
        height: null,
        uploadedBy: user,
        createdAt: NOW,
      };
      const tx = new ServerTx(q, { userId: user });
      expect(await code(tx.put('attachments', att))).toBe('forbidden');
      await q
        .insert(schema.files)
        .values({ sha256: sha, size: 5_000_000_000, mime: 'x/y', createdBy: other });
      // файл загрузил другой пользователь (files.created_by не в счёт)
      expect(await code(tx.put('attachments', att))).toBe('forbidden');
      await q.insert(schema.fileUploads).values({ sha256: sha, userId: user });
      expect(await code(tx.put('attachments', att))).toBe('ok');
      expect((await tx.get('attachments', att.id))!.size).toBe(5_000_000_000);
      // второй загрузивший тот же файл
      await q.insert(schema.fileUploads).values({ sha256: sha, userId: other });
      const tx2 = new ServerTx(q, { userId: other });
      await ServerTx.asSystem(q, { userId: user }).put('spaceMembers', {
        id: uuidv7(),
        spaceId,
        userId: other,
        role: 'member',
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(await code(tx2.put('attachments', { ...att, id: uuidv7(), uploadedBy: other }))).toBe(
        'ok',
      );
      // без загрузки, но файл уже приложен в этом пространстве
      const third = await mkUser(db);
      await ServerTx.asSystem(q, { userId: user }).put('spaceMembers', {
        id: uuidv7(),
        spaceId,
        userId: third,
        role: 'member',
        createdAt: NOW,
        updatedAt: NOW,
      });
      const tx3 = new ServerTx(q, { userId: third });
      expect(await code(tx3.put('attachments', { ...att, id: uuidv7(), uploadedBy: third }))).toBe(
        'ok',
      );
    });
  });
});

describe('ServerTx: changes, номера, activity, ошибки', () => {
  it('колонки видимости по scope; del — data null', async () => {
    const owner = await mkUser(db);
    const spaceId = await mkSpace(db, owner, { [owner]: 'admin' });
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      const l = label(spaceId);
      await tx.put('labels', l);
      await tx.del('labels', l.id);
      const rows = await chg(q, l.id);
      expect(rows.map((r) => [r.op, r.spaceId, r.userId, r.data === null])).toEqual([
        ['put', spaceId, null, false],
        ['del', spaceId, null, true],
      ]);
      expect(rows[0].data).toEqual(l);
      const s = { id: `g${uuidv7()}`, value: [1], updatedAt: NOW };
      await tx.put('settings', s);
      expect((await chg(q, s.id))[0]).toMatchObject({ spaceId: null, userId: null });
      const n: Row<'notifications'> = {
        id: uuidv7(),
        userId: owner,
        spaceId,
        kind: 'mentioned',
        taskId: uuidv7(),
        commentId: null,
        actorId: owner,
        readAt: null,
        createdAt: NOW,
      };
      await tx.put('notifications', n);
      expect((await chg(q, n.id))[0]).toMatchObject({ spaceId: null, userId: owner });
    });
  });

  it('settings.enabled_modules → _reset для всех; spaceMembers → _reset участнику', async () => {
    const owner = await mkUser(db);
    const other = await mkUser(db);
    const spaceId = await mkSpace(db, owner, {});
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      await tx.put('settings', { id: 'enabled_modules', value: [], updatedAt: NOW });
      expect((await chg(q, 'enabled_modules')).map((r) => [r.entity, r.spaceId, r.userId])).toEqual(
        [
          ['settings', null, null],
          ['_reset', null, null],
        ],
      );
      const m: Row<'spaceMembers'> = {
        id: uuidv7(),
        spaceId,
        userId: other,
        role: 'member',
        createdAt: NOW,
        updatedAt: NOW,
      };
      await tx.put('spaceMembers', m);
      await tx.put('spaceMembers', { ...m, role: 'guest' });
      expect((await chg(q, other)).map((r) => [r.entity, r.userId])).toEqual([['_reset', other]]);
      await tx.del('spaceMembers', m.id);
      expect(await chg(q, other)).toHaveLength(2);
    });
  });

  it('первой записью в changes берётся advisory lock 7311', async () => {
    const owner = await mkUser(db);
    const spaceId = await mkSpace(db, owner, {});
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      const locks = () =>
        q.execute(
          sql`select count(*)::int n from pg_locks where locktype='advisory' and objid=7311 and pid=pg_backend_pid()`,
        );
      expect((await locks()).rows[0].n).toBe(0);
      await tx.put('labels', label(spaceId));
      expect((await locks()).rows[0].n).toBe(1);
    });
  });

  it('номер задачи растёт по проекту; явный number сохраняется', async () => {
    const owner = await mkUser(db);
    const spaceId = await mkSpace(db, owner, {});
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      const st = {
        id: uuidv7(),
        spaceId,
        name: 's',
        category: 'todo' as const,
        color: '#000',
        rank: 'a0',
        createdAt: NOW,
        updatedAt: NOW,
      };
      await tx.put('statuses', st);
      const [p1, p2] = [project(spaceId), project(spaceId)];
      await tx.put('projects', p1);
      await tx.put('projects', p2);
      const t = (projectId: string, number: number | null): Row<'tasks'> => ({
        id: uuidv7(),
        spaceId,
        projectId,
        number,
        parentId: null,
        statusId: st.id,
        title: 't',
        description: null,
        priority: 0,
        rank: 'a0',
        dueDate: null,
        startDate: null,
        createdBy: owner,
        completedAt: null,
        fields: {},
        createdAt: NOW,
        updatedAt: NOW,
      });
      const rows = [t(p1.id, null), t(p1.id, null), t(p2.id, null)];
      for (const r of rows) await tx.put('tasks', r);
      const nums: (number | null)[] = [];
      for (const r of rows) nums.push((await tx.get('tasks', r.id))!.number);
      expect(nums).toEqual([1, 2, 1]);
      const wire = (await chg(q, rows[1].id))[0].data as Row<'tasks'>;
      expect(wire.number).toBe(2);
    });
  });

  it('activity: created, updated (без updatedAt/rank), без изменений — пусто, deleted', async () => {
    const owner = await mkUser(db);
    const spaceId = await mkSpace(db, owner, {});
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      const st = {
        id: uuidv7(),
        spaceId,
        name: 's',
        category: 'todo' as const,
        color: '#000',
        rank: 'a0',
        createdAt: NOW,
        updatedAt: NOW,
      };
      await tx.put('statuses', st);
      const p = project(spaceId);
      await tx.put('projects', p);
      const t: Row<'tasks'> = {
        id: uuidv7(),
        spaceId,
        projectId: p.id,
        number: null,
        parentId: null,
        statusId: st.id,
        title: 'a',
        description: null,
        priority: 0,
        rank: 'a0',
        dueDate: null,
        startDate: null,
        createdBy: owner,
        completedAt: null,
        fields: {},
        createdAt: NOW,
        updatedAt: NOW,
      };
      await tx.put('tasks', t);
      await tx.patch('tasks', t.id, { updatedAt: '2026-10-22T12:00:00.000Z', rank: 'b0' });
      await tx.patch('tasks', t.id, { title: 'b', rank: 'c0' });
      await tx.del('tasks', t.id);
      const acts = (await tx.scan('activity', { index: 'taskId', eq: t.id })).sort((x, y) =>
        x.id < y.id ? -1 : 1,
      );
      expect(acts.map((a) => [a.kind, a.actorId, a.spaceId])).toEqual([
        ['created', owner, spaceId],
        ['updated', owner, spaceId],
        ['deleted', owner, spaceId],
      ]);
      expect(acts[1].changes).toEqual({ title: ['a', 'b'] });
    });
  });

  it('activity: исполнители, метки, комментарии', async () => {
    const owner = await mkUser(db);
    const spaceId = await mkSpace(db, owner, {});
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      const st = {
        id: uuidv7(),
        spaceId,
        name: 's',
        category: 'todo' as const,
        color: '#000',
        rank: 'a0',
        createdAt: NOW,
        updatedAt: NOW,
      };
      await tx.put('statuses', st);
      const p = project(spaceId);
      await tx.put('projects', p);
      const t: Row<'tasks'> = {
        id: uuidv7(),
        spaceId,
        projectId: p.id,
        number: null,
        parentId: null,
        statusId: st.id,
        title: 'a',
        description: null,
        priority: 0,
        rank: 'a0',
        dueDate: null,
        startDate: null,
        createdBy: owner,
        completedAt: null,
        fields: {},
        createdAt: NOW,
        updatedAt: NOW,
      };
      await tx.put('tasks', t);
      const l = label(spaceId);
      await tx.put('labels', l);
      const as: Row<'taskAssignees'> = {
        id: uuidv7(),
        spaceId,
        taskId: t.id,
        userId: owner,
        createdAt: NOW,
      };
      const tl: Row<'taskLabels'> = {
        id: uuidv7(),
        spaceId,
        taskId: t.id,
        labelId: l.id,
        createdAt: NOW,
      };
      const c: Row<'comments'> = {
        id: uuidv7(),
        spaceId,
        taskId: t.id,
        authorId: owner,
        body: { type: 'doc' },
        mentions: [],
        editedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      await tx.put('taskAssignees', as);
      await tx.put('taskLabels', tl);
      await tx.put('comments', c);
      await tx.put('comments', { ...c, editedAt: NOW });
      await tx.del('taskAssignees', as.id);
      await tx.del('taskLabels', tl.id);
      const acts = await tx.scan('activity', { index: 'taskId', eq: t.id });
      const by = Object.fromEntries(acts.map((a) => [a.kind, a.changes]));
      expect(acts.map((a) => a.kind).sort()).toEqual([
        'assignee_added',
        'assignee_removed',
        'commented',
        'created',
        'label_added',
        'label_removed',
      ]);
      expect(by).toMatchObject({
        assignee_added: { userId: owner },
        label_removed: { labelId: l.id },
        commented: { commentId: c.id },
      });
    });
  });

  it('23505 → conflict (ключ проекта), 23503 → invalid_args (нет проекта у задачи)', async () => {
    const owner = await mkUser(db);
    const spaceId = await mkSpace(db, owner, {});
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      const p = project(spaceId);
      await tx.put('projects', p);
      expect(await code(tx.put('projects', project(spaceId, { key: p.key })))).toBe('conflict');
    });
    await inTx(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: owner });
      const bad = { ...label(spaceId), spaceId: uuidv7() };
      expect(await code(tx.put('labels', bad))).toBe('invalid_args');
    });
  });

  it('pg_notify planar_changes после finish с номером последней записи', async () => {
    const owner = await mkUser(db);
    const spaceId = await mkSpace(db, owner, {});
    const listener = new pg.Client({ connectionString: dbUrl });
    await listener.connect();
    await listener.query('LISTEN planar_changes');
    const got: string[] = [];
    listener.on('notification', (m) => got.push(m.payload!));
    const seq = await db.transaction(async (tx) => {
      const stx = ServerTx.asSystem(tx, { userId: owner });
      await stx.put('labels', label(spaceId));
      await stx.finish();
      const [r] = (await tx.execute(sql`select max(seq)::int s from changes`)).rows;
      return r.s as number;
    });
    await new Promise((r) => setTimeout(r, 200));
    await listener.end();
    expect(got).toContain(String(seq));
  });
});
