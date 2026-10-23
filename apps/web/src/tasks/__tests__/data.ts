import 'fake-indexeddb/auto';
import { uuidv7 } from '@planar/shared';
import { db } from '../../sync';

export const T = '2026-10-22T10:00:00.000Z';
export const id = uuidv7;
export const ids = {
  space: id(),
  project: id(),
  todo: id(),
  done: id(),
  ann: id(),
  bob: id(),
  bug: id(),
};

// Тесты пишут в реплику напрямую, минуя sync-клиент. Клиент сообщает о своих записях через
// onReplicaChange (в том числе из «другой вкладки» — BroadcastChannel), поэтому прямые записи
// тестов объявляем так же, как это сделала бы другая вкладка.
const channel = new BroadcastChannel('planar-replica');
(channel as unknown as { unref?: () => void }).unref?.();
const announce = (batch: { entity: string; id: string; row: unknown }[]) =>
  channel.postMessage({ db: db.name, batch });
let bridged = false;
function bridge() {
  if (bridged) return;
  bridged = true;
  type Fn = (...a: unknown[]) => Promise<unknown>;
  for (const t of db.entityTables()) {
    const wrap = (
      name: 'put' | 'bulkPut' | 'delete',
      rows: (a: unknown[]) => { id: string; row: unknown }[],
    ) => {
      const orig = (t[name] as unknown as Fn).bind(t);
      (t as unknown as Record<string, Fn>)[name] = async (...a) => {
        const r = await orig(...a);
        announce(rows(a).map((x) => ({ entity: t.name, ...x })));
        return r;
      };
    };
    wrap('put', ([row]) => [{ id: (row as { id: string }).id, row }]);
    wrap('bulkPut', ([rows]) => (rows as { id: string }[]).map((row) => ({ id: row.id, row })));
    wrap('delete', ([key]) => [{ id: key as string, row: null }]);
  }
}

export async function reset() {
  await db.open();
  bridge();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.table('spaces').put({
    id: ids.space,
    name: 'S',
    description: null,
    color: null,
    icon: null,
    rank: 'a0',
    createdBy: ids.ann,
    createdAt: T,
    updatedAt: T,
  });
  await db.table('projects').bulkPut([
    {
      id: ids.project,
      spaceId: ids.space,
      name: 'P',
      key: 'PLN',
      description: null,
      color: null,
      icon: null,
      leadId: null,
      rank: 'a0',
      archivedAt: null,
      createdAt: T,
      updatedAt: T,
    },
    {
      id: id(),
      spaceId: ids.space,
      name: 'Old',
      key: 'OLD',
      description: null,
      color: null,
      icon: null,
      leadId: null,
      rank: 'a1',
      archivedAt: T,
      createdAt: T,
      updatedAt: T,
    },
  ]);
  await db.table('statuses').bulkPut([
    {
      id: ids.done,
      spaceId: ids.space,
      name: 'Done',
      category: 'done',
      color: '#0a0',
      rank: 'a2',
      createdAt: T,
      updatedAt: T,
    },
    {
      id: ids.todo,
      spaceId: ids.space,
      name: 'Todo',
      category: 'todo',
      color: '#888',
      rank: 'a1',
      createdAt: T,
      updatedAt: T,
    },
  ]);
  const u = (i: string, name: string, deactivatedAt: string | null = null) => ({
    id: i,
    login: name,
    name,
    email: null,
    role: 'member',
    avatarFile: null,
    deactivatedAt,
    createdAt: T,
    updatedAt: T,
  });
  await db.table('users').bulkPut([u(ids.ann, 'Ann'), u(ids.bob, 'Bob', T)]);
  await db.table('spaceMembers').bulkPut(
    [ids.ann, ids.bob].map((userId) => ({
      id: id(),
      spaceId: ids.space,
      userId,
      role: 'member',
      createdAt: T,
      updatedAt: T,
    })),
  );
  await db.table('labels').put({
    id: ids.bug,
    spaceId: ids.space,
    name: 'bug',
    color: '#f00',
    createdAt: T,
    updatedAt: T,
  });
  announce([{ entity: '*', id: '*', row: null }]); // таблицы очищены напрямую: проекции перечитать
}

export const task = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(),
  spaceId: ids.space,
  projectId: ids.project,
  number: n,
  parentId: null,
  statusId: ids.todo,
  title: `t${n}`,
  description: null,
  priority: 0,
  rank: `a${n}`,
  dueDate: null,
  startDate: null,
  createdBy: ids.ann,
  completedAt: null,
  fields: {},
  createdAt: T,
  updatedAt: T,
  ...over,
});

export const until = async <T>(f: () => T | undefined | false, ms = 3000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('until: таймаут');
    await new Promise((r) => setTimeout(r, 5));
  }
};
