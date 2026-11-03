import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test('pj19: зажим ширины и значение по умолчанию', async () => {
  const m = await import('./taskPanelWidth');
  expect(m.taskPanelWidth.value).toBe(m.TASK_PANEL_DEFAULT);
  expect(m.clampPanelWidth(10)).toBe(m.TASK_PANEL_MIN);
  expect(m.clampPanelWidth(99999)).toBe(m.TASK_PANEL_MAX);
  expect(m.clampPanelWidth(NaN)).toBe(m.TASK_PANEL_DEFAULT);
});

test('pj19: ширина сохраняется и читается заново, мусор зажимается', async () => {
  let m = await import('./taskPanelWidth');
  m.setTaskPanelWidth(700);
  expect(localStorage.getItem('planar.taskPanelWidth')).toBe('700');
  vi.resetModules();
  m = await import('./taskPanelWidth');
  expect(m.taskPanelWidth.value).toBe(700);
  localStorage.setItem('planar.taskPanelWidth', '50000');
  vi.resetModules();
  m = await import('./taskPanelWidth');
  expect(m.taskPanelWidth.value).toBe(m.TASK_PANEL_MAX);
});
