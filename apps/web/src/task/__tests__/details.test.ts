import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { SYNC_PROTOCOL } from '@planar/shared';
import { startSync, stopSync, syncState } from '../../sync';
import { confirmDone, closePrompt } from '../../tasks/closeOpen';
import { i18n } from '../../i18n';
import { toasts } from '../../ui/toast';
import { db, eventually, flushPromises, ids, open, setup, until } from './h';

// PLNRAPP-487 (C-sync v3): details of a task (comments) — a skeleton while loading, «unavailable offline», closeOpen waits

let w: VueWrapper | undefined;
let t: Awaited<ReturnType<typeof setup>>;
afterEach(() => {
  w?.unmount();
  w = undefined;
});

const comment = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  spaceId: ids.space,
  taskId: t.id,
  authorId: ids.ann,
  parentId: null,
  body: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'с сервера' }] }],
  },
  mentions: [],
  assigneeId: null,
  resolvedAt: null,
  resolvedBy: null,
  editedAt: null,
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
  ...over,
});

/** `POST /sync/tasks` is answered only when `release` is called; offline — every request fails. */
async function server(rows: Record<string, unknown>[] | 'offline') {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  const fetch = async (path: string, init?: RequestInit) => {
    if (rows === 'offline') throw new TypeError('offline');
    if (path.startsWith('/sync/tasks')) {
      await gate;
      const { ids: req } = JSON.parse(String(init?.body)) as { ids: string[] };
      return json({
        cursor: 5,
        tasks: req.map((taskId) => ({
          taskId,
          status: 'ok',
          comments: rows,
          commentReactions: [],
        })),
      });
    }
    if (path.startsWith('/sync/pull'))
      return json({ changes: [], cursor: 5, lastMutationId: 0, protocol: SYNC_PROTOCOL });
    if (path.startsWith('/sync/push')) return json({ results: [] });
    throw new TypeError('offline');
  };
  await stopSync();
  // a bootstrapped replica: snapshots of the task details are applied over its cursor
  await db._meta.put({ key: 'cursor', value: 5 });
  await db._meta.put({ key: 'schema', value: db.schemaSig() });
  await db._meta.put({ key: 'protocol', value: SYNC_PROTOCOL });
  await startSync({ userId: ids.ann, fetch: fetch as never });
  return release;
}

/**
 * PLNRAPP-729: v3 server whose bootstrap holds the task (its details — in `data`), `POST /sync/tasks` is cut off.
 * `fresh` — an empty replica (cold bootstrap); `v2` — a replica bootstrapped by v2 (protocol=2, empty `_held`).
 */
async function heldServer(rows: Record<string, unknown>[], replica: 'fresh' | 'v2') {
  const data: Record<string, unknown[]> = {};
  for (const tb of db.entityTables()) data[tb.name] = await tb.toArray();
  data.comments = rows;
  let tasksCalls = 0;
  let bootstraps = 0;
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  const fetch = async (path: string) => {
    if (path.startsWith('/sync/tasks')) {
      tasksCalls++;
      throw new TypeError('offline');
    }
    if (path.startsWith('/sync/bootstrap')) {
      bootstraps++;
      return json({ cursor: 5, lastMutationId: 0, data, held: [t.id] });
    }
    if (path.startsWith('/sync/pull')) return json({ changes: [], cursor: 5, lastMutationId: 0 });
    if (path.startsWith('/sync/push')) return json({ results: [] });
    throw new TypeError('offline');
  };
  await stopSync();
  await db._held.clear();
  if (replica === 'fresh') await db._meta.delete('cursor');
  else {
    await db._meta.put({ key: 'cursor', value: 5 });
    await db._meta.put({ key: 'schema', value: db.schemaSig() });
    await db._meta.put({ key: 'protocol', value: 2 });
  }
  await startSync({ userId: ids.ann, fetch: fetch as never });
  // a warm start bootstraps in the background: wait until the task is held
  await eventually(async () => !!(await db._held.get(t.id)));
  return { tasksCalls: () => tasksCalls, bootstraps: () => bootstraps };
}

beforeEach(async () => {
  t = await setup();
  toasts.value = [];
});

describe('детали задачи (PLNRAPP-487)', () => {
  it('задача без деталей: скелет, затем комментарии со снимка', async () => {
    const release = await server([comment()]);
    w = await open();
    await until(() => w!.find('[data-testid="feed-skeleton"]').exists());
    expect(w.find('[data-testid="feed"]').text()).not.toContain('с сервера');
    release();
    // the comments reach the replica (and the feed) a tick before the details turn ready: wait for both
    await until(
      () =>
        w!.find('[data-testid="feed"]').text().includes('с сервера') &&
        !w!.find('[data-testid="feed-skeleton"]').exists(),
    );
    expect(await db._held.get(t.id)).toBeTruthy();
  });

  it('офлайн без деталей — «недоступно без сети»', async () => {
    await server('offline');
    w = await open();
    await until(() => w!.find('[data-testid="feed-offline"]').exists());
    expect(w.get('[data-testid="feed-offline"]').text()).toBe('Комментарии недоступны без сети');
    expect(w.find('[data-testid="feed-skeleton"]').exists()).toBe(false);
  });

  it('офлайн, но задача удержана — детали на месте, без заглушки', async () => {
    await server('offline');
    await db._held.put({ taskId: t.id, loadedAt: t.createdAt, accessedAt: t.createdAt });
    await db.table('comments').put(comment());
    w = await open();
    await until(() => w!.find('[data-testid="feed"]').text().includes('с сервера'));
    await flushPromises();
    expect(w.find('[data-testid="feed-offline"]').exists()).toBe(false);
    expect(w.find('[data-testid="feed-skeleton"]').exists()).toBe(false);
  });

  it('closeOpen: по счётчикам есть открытые назначенные, деталей нет и нет сети — отмена с сообщением', async () => {
    await db.table('tasks').update(t.id, { commentsAssigned: 1, commentsResolved: 0 });
    await server('offline');
    expect(await confirmDone(t.id, ids.done)).toBe(false);
    expect(closePrompt.value).toBeNull();
    expect(toasts.value.at(-1)?.text).toBe(i18n.global.t('closeOpen.offline'));
  });

  it('closeOpen ждёт деталей и спрашивает про назначенный комментарий со снимка', async () => {
    await db.table('tasks').update(t.id, { commentsAssigned: 1, commentsResolved: 0 });
    const c = comment({ assigneeId: ids.bob });
    const release = await server([c]);
    const done = confirmDone(t.id, ids.done);
    await new Promise((r) => setTimeout(r, 20));
    expect(closePrompt.value).toBeNull(); // the details are still loading
    release();
    const p = await until(() => closePrompt.value);
    expect(p.commentIds).toEqual([c.id]);
    p.answer(false);
    expect(await done).toBe(false);
  });

  it('closeOpen без открытых назначенных по счётчикам — без запроса деталей, сразу', async () => {
    await server('offline');
    expect(await confirmDone(t.id, ids.done)).toBe(true);
    expect(syncState.value.status).not.toBe('online');
  });

  for (const replica of ['fresh', 'v2'] as const)
    it(`closeOpen (PLNRAPP-729, ${replica === 'fresh' ? 'свежая реплика' : 'реплика v2 → v3'}): задача из _held, /sync/tasks оборван — диалог «Назначенные комментарии», без тоста`, async () => {
      await db.table('tasks').update(t.id, { commentsAssigned: 1, commentsResolved: 0 });
      const c = comment({ assigneeId: ids.bob });
      const srv = await heldServer([c], replica);
      expect(srv.bootstraps()).toBe(1);
      expect((await db._meta.get('protocol'))?.value).toBe(SYNC_PROTOCOL);
      const done = confirmDone(t.id, ids.done);
      const p = (await until(() => closePrompt.value))!;
      expect(p.commentIds).toEqual([c.id]);
      expect(toasts.value.some((x) => x.text === i18n.global.t('closeOpen.offline'))).toBe(false);
      // held details are complete: no request for the snapshot
      expect(srv.tasksCalls()).toBe(0);
      p.answer(false);
      expect(await done).toBe(false);
    });
});
