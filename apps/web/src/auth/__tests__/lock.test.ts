import { afterEach, describe, expect, it, vi } from 'vitest';
import { countdown, initLock, stillHere } from '../lock';
import { useAuth } from '../useAuth';
import { json, mkUser, mockFetch } from './helpers';

afterEach(() => vi.useRealTimers());

describe('блокировка при простое', () => {
  it('N минут без действий → отсчёт 10 с; клик отменяет; по истечении — блокировка сразу', async () => {
    vi.useFakeTimers();
    const f = mockFetch(() => json(204));
    const a = useAuth();
    a.user.value = mkUser();
    a.ready.value = true;
    a.locked.value = false;
    a.lockPrefs.value = { onOpen: false, minutes: 1, wipe: false };
    initLock();

    await vi.advanceTimersByTimeAsync(59_000);
    expect(countdown.value).toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(countdown.value).toBeGreaterThan(0);
    expect(countdown.value).toBeLessThanOrEqual(10);

    stillHere();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(countdown.value).toBeNull();
    expect(a.locked.value).toBe(false);

    await vi.advanceTimersByTimeAsync(31_000 + 10_000);
    expect(a.locked.value).toBe(true);
    expect(countdown.value).toBeNull();
    expect(f.mock.calls.some(([p, i]) => p === '/api/auth/lock' && i?.method === 'POST')).toBe(
      true,
    );
  });
});
