import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test('pj18: зажим ширины и значение по умолчанию', async () => {
  const m = await import('../sidebarWidth');
  expect(m.sidebarWidth.value).toBe(m.SIDEBAR_DEFAULT);
  expect(m.clampWidth(10)).toBe(m.SIDEBAR_MIN);
  expect(m.clampWidth(9999)).toBe(m.SIDEBAR_MAX);
  expect(m.clampWidth(NaN)).toBe(m.SIDEBAR_DEFAULT);
});

test('pj18: ширина сохраняется и читается заново, мусор в хранилище зажимается', async () => {
  let m = await import('../sidebarWidth');
  m.setSidebarWidth(300);
  expect(localStorage.getItem('planar.sidebarWidth')).toBe('300');
  vi.resetModules();
  m = await import('../sidebarWidth');
  expect(m.sidebarWidth.value).toBe(300);
  localStorage.setItem('planar.sidebarWidth', '5000');
  vi.resetModules();
  m = await import('../sidebarWidth');
  expect(m.sidebarWidth.value).toBe(m.SIDEBAR_MAX);
});
