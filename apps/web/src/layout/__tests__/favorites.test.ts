import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('избранное', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  it('старый формат — id проектов — читается как проекты', async () => {
    localStorage.setItem('planar.favorites', JSON.stringify(['p1', 42, null]));
    const { favorites } = await import('../nav');
    expect(favorites.has('project', 'p1')).toBe(true);
    expect(favorites.has('space', 'p1')).toBe(false);
  });
  it('toggle добавляет и снимает по виду и id, пишет в localStorage', async () => {
    const { favorites } = await import('../nav');
    favorites.toggle({ kind: 'task', id: 't1', name: 'Задача', to: '/t/PLN-1' });
    favorites.toggle({ kind: 'doc', id: 't1', name: 'Док', to: '/m/docs/t1' });
    expect(favorites.has('task', 't1') && favorites.has('doc', 't1')).toBe(true);
    favorites.toggle({ kind: 'task', id: 't1', name: '', to: '' });
    expect(favorites.has('task', 't1')).toBe(false);
    expect(JSON.parse(localStorage.getItem('planar.favorites')!)).toEqual([
      { kind: 'doc', id: 't1', name: 'Док', to: '/m/docs/t1' },
    ]);
  });
});
