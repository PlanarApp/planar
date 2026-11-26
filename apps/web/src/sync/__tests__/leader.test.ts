// Tabs (navigator.locks): a tab that becomes the leader later takes the cursor the old leader left in _meta.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { label, setup, stopAll } from './helpers';

/** navigator.locks for one name: the holder runs until its callback settles, waiters queue up */
function fakeLocks() {
  let busy: Promise<unknown> | null = null;
  const queue: (() => void)[] = [];
  const run = async (cb: (l: object | null) => unknown) => {
    const p = Promise.resolve(cb({}));
    busy = p;
    await p.catch(() => {});
    busy = null;
    queue.shift()?.();
  };
  return {
    request(_name: string, o: unknown, f?: unknown) {
      const cb = (typeof o === 'function' ? o : f) as (l: object | null) => unknown;
      const ifAvailable = typeof o === 'object' && (o as { ifAvailable?: boolean }).ifAvailable;
      if (!busy) return run(cb);
      if (ifAvailable) return Promise.resolve(cb(null));
      return new Promise<void>((r) => queue.push(() => void run(cb).then(r)));
    },
  };
}

let saved: unknown;
beforeEach(() => {
  saved = (navigator as { locks?: unknown }).locks;
  Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true });
});
afterEach(async () => {
  await stopAll();
  Object.defineProperty(navigator, 'locks', { value: saved, configurable: true });
});

describe('лидер вкладок', () => {
  it('ведомая вкладка видит наполненную реплику, а став лидером — не делает второй bootstrap', async () => {
    const s = setup();
    s.server.v3 = true; // as the real server: bootstrap carries held (C-sync v3)
    s.server.seed('labels', [label('a')]);
    const a = s.mk();
    const b = s.mk();
    // the browser restores both tabs on an empty replica: both read «no cursor», one leads and bootstraps
    await Promise.all([s.start(a), s.start(b)]);
    await a.syncNow();
    await b.syncNow();
    expect(s.server.bootstraps).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect([a.replicaState.value, b.replicaState.value]).toEqual(['complete', 'complete']);
    // the leader's tab is closed: the other one takes the lock
    const leader = b.syncState.value.status === 'idle' ? a : b;
    const other = leader === a ? b : a;
    await leader.stopSync();
    await new Promise((r) => setTimeout(r, 50));
    await other.syncNow();
    expect(s.server.bootstraps).toBe(1);
  });

  it('другая вкладка очистила реплику (выход, другой пользователь): лидер останавливается, а не синхронизирует со старым clientId', async () => {
    const s = setup();
    const a = s.mk();
    const b = s.mk();
    await s.start(a);
    await s.start(b);
    await a.syncNow();
    let out = 0;
    a.onUnauthorized(() => out++);
    await b.clearLocal();
    await vi.waitFor(() => expect(out).toBe(1));
    const [pulls, pushes] = [s.server.pulls, s.server.pushes];
    await a.syncNow();
    expect([s.server.pulls, s.server.pushes]).toEqual([pulls, pushes]);
  });
});
