// A sign-in on a device with another user's replica: it is cleared before the screens read it;
// the previous user's unsent edits go only after confirmation.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, stopSync } from '../../sync';
import { useAuth } from '../useAuth';
import { json, mkUser, mockFetch, resetAuth } from './helpers';

const B = mkUser({ id: '0190-u2', login: 'bob' });

beforeEach(async () => {
  resetAuth();
  await stopSync();
  await db.open();
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  await db._meta.put({ key: 'userId', value: '0190-u1' });
  await db.table('labels').put({ id: 'l1' });
});

const login = () =>
  mockFetch((m, p) =>
    p === '/api/auth/login' ? json(200, { user: B }) : m === 'POST' ? json(204) : undefined,
  );

describe('вход другого пользователя', () => {
  it('без очереди: реплика предыдущего очищается до входа', async () => {
    login();
    await useAuth().login('bob', 'x');
    expect(await db.table('labels').count()).toBe(0);
    expect(useAuth().user.value?.id).toBe(B.id);
  });

  it('с неотправленными правками: диалог; отмена — новый пользователь выходит, правки остаются', async () => {
    await db._queue.add({ name: 'x', args: {}, createdAt: 'a' });
    const f = login();
    const { logoutPrompt } = useAuth();
    const p = useAuth().login('bob', 'x');
    await vi.waitFor(() => expect(logoutPrompt.open.value).toBe(true));
    expect(logoutPrompt.kind.value).toBe('switch');
    expect(useAuth().user.value).toBeNull();
    logoutPrompt.answer(false);
    await p;
    expect(f.mock.calls.map((c) => c[0])).toContain('/api/auth/logout');
    expect(useAuth().user.value).toBeNull();
    expect(await db._queue.count()).toBe(1);
  });

  it('с неотправленными правками: подтверждение — очередь и реплика очищены, вход выполнен', async () => {
    await db._queue.add({ name: 'x', args: {}, createdAt: 'a' });
    login();
    const { logoutPrompt } = useAuth();
    const p = useAuth().login('bob', 'x');
    await vi.waitFor(() => expect(logoutPrompt.open.value).toBe(true));
    logoutPrompt.answer(true);
    await p;
    expect(await db._queue.count()).toBe(0);
    expect(useAuth().user.value?.id).toBe(B.id);
  });
});
