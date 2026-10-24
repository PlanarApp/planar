import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { ensureModule, moduleStatus } from '../registry';

it('нет настроек 10 с → error, а не вечный скелетон', async () => {
  vi.useFakeTimers();
  expect(moduleStatus('x')).toBe('loading');
  const p = ensureModule('x');
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await p).toBe(false);
  expect(moduleStatus('x')).toBe('error');
  vi.useRealTimers();
});
