import { describe, expect, it } from 'vitest';
import { createSpace, projectKey } from '../sidebarActions';

describe('projectKey', () => {
  it('латиница и цифры, до 6 символов', () => {
    expect(projectKey('Mobile app 2', new Set())).toBe('MOBILE');
  });
  it('кириллица транслитом', () => {
    expect(projectKey('Склад', new Set())).toBe('SKLAD');
  });
  it('ведущие цифры отбрасываются, слишком короткий ключ дополняется', () => {
    expect(projectKey('1 x', new Set())).toBe('XR');
  });
  it('занятый ключ получает номер', () => {
    expect(projectKey('Склад', new Set(['SKLAD', 'SKLAD2']))).toBe('SKLAD3');
  });
  it('ключ проходит схему мутатора', () => {
    for (const n of ['', '???', 'Ёжик в тумане', 'Щука']) {
      expect(projectKey(n, new Set())).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
    }
  });
});

describe('createSpace', () => {
  const spaces = [
    { id: 's1', projects: [{ id: 'p1' }] },
    { id: 's2', projects: [{ id: 'p2' }] },
  ] as never;
  it('выбран спейс — он', () => {
    expect(createSpace(spaces, { name: 'space', params: { spaceId: 's2' } })?.id).toBe('s2');
  });
  it('выбран проект — его спейс', () => {
    expect(createSpace(spaces, { name: 'project', params: { projectId: 'p2' } })?.id).toBe('s2');
  });
  it('иначе первый', () => {
    expect(createSpace(spaces, { name: 'home', params: {} })?.id).toBe('s1');
  });
});
