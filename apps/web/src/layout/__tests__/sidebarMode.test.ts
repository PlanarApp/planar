import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test('pj20: режим сайдбара по умолчанию full, сохраняется, мусор даёт full', async () => {
  let m = await import('../sidebarWidth');
  expect(m.sidebarMode.value).toBe('full');
  m.setSidebarMode('rail');
  expect(localStorage.getItem('planar.sidebarMode')).toBe('rail');
  vi.resetModules();
  m = await import('../sidebarWidth');
  expect(m.sidebarMode.value).toBe('rail');
  localStorage.setItem('planar.sidebarMode', 'bogus');
  vi.resetModules();
  m = await import('../sidebarWidth');
  expect(m.sidebarMode.value).toBe('full');
});
