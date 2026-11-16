import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test('PLNRAPP-200: зажим ширины панели комментариев', async () => {
  const m = await import('../asideWidth');
  expect(m.asideWidth.value).toBe(m.ASIDE_DEFAULT);
  expect(m.clampAside(10, 1200)).toBe(m.ASIDE_MIN);
  expect(m.clampAside(9999, 1000)).toBe(600); // 60 %
  expect(m.clampAside(9999, 900)).toBe(540); // 60 % = 540, main keeps 360
  expect(m.clampAside(500, 1200)).toBe(500);
  expect(m.clampAside(Number.NaN)).toBe(m.ASIDE_DEFAULT);
});

test('PLNRAPP-200: ширина запоминается в localStorage', async () => {
  let m = await import('../asideWidth');
  m.setAsideWidth(450, 1400);
  expect(localStorage.getItem('planar.taskAsideWidth')).toBe('450');
  vi.resetModules();
  m = await import('../asideWidth');
  expect(m.asideWidth.value).toBe(450);
  localStorage.setItem('planar.taskAsideWidth', 'junk');
  vi.resetModules();
  m = await import('../asideWidth');
  expect(m.asideWidth.value).toBe(m.ASIDE_DEFAULT);
});
