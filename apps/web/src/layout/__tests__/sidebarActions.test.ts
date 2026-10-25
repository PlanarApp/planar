import { describe, expect, it } from 'vitest';
import { projectKey } from '../sidebarActions';

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
