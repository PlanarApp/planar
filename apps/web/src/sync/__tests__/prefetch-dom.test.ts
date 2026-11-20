// PLNRAPP-488: наведение на [data-task-id] и простой отдают задачи в prefetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_SCAN_INTERVAL, installTaskPrefetch } from '../prefetch';

let off: (() => void) | undefined;
afterEach(() => {
  off?.();
  off = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('PLNRAPP-488: installTaskPrefetch', () => {
  it('наведение на задачу (и на её потомка) инициирует загрузку деталей', () => {
    const prefetch = vi.fn();
    document.body.innerHTML =
      '<div data-task-id="t1"><span id="in">x</span></div><div id="other">y</div>';
    off = installTaskPrefetch(prefetch);
    document.getElementById('in')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    document.getElementById('other')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(prefetch.mock.calls.map((c) => [...(c[0] as Iterable<string>)])).toEqual([['t1']]);
  });

  it('в простое — отрисованные задачи, не больше 100', () => {
    vi.useFakeTimers();
    const prefetch = vi.fn();
    document.body.innerHTML = Array.from(
      { length: 150 },
      (_, i) => `<div data-task-id="t${i}"></div>`,
    ).join('');
    off = installTaskPrefetch(prefetch);
    vi.advanceTimersByTime(IDLE_SCAN_INTERVAL + 100);
    vi.runOnlyPendingTimers();
    expect(prefetch).toHaveBeenCalled();
    const ids = [...(prefetch.mock.calls[0]![0] as Iterable<string>)];
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('t0');
  });

  it('после снятия — ничего', () => {
    const prefetch = vi.fn();
    document.body.innerHTML = '<div data-task-id="t1" id="t"></div>';
    installTaskPrefetch(prefetch)();
    document.getElementById('t')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(prefetch).not.toHaveBeenCalled();
  });
});
