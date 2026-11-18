import { describe, expect, it } from 'vitest';
import {
  branchTemplateError,
  gitRefError,
  renderBranch,
  translit,
} from '../../../../../../modules/gitlab/shared/branch-name';

describe('PLNRAPP-153: имя ветки по шаблону', () => {
  it('транслитерация: нижний регистр, кириллица → латиница, прочее → «-», без повторов, ≤ 50', () => {
    expect(translit('Исправить вход в систему!')).toBe('ispravit-vhod-v-sistemu');
    expect(translit('  Щука, ёж и Fix #42 — съел  ')).toBe('schuka-ezh-i-fix-42-sel');
    expect(translit('???')).toBe('');
    const long = translit('Очень длинное название задачи, которое точно не поместится в пятьдесят');
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long).not.toMatch(/^-|-$/);
  });

  it('подстановка полей', () => {
    const v = { key: 'PLN-7', title: 'Кнопка опроса', login: 'ann' };
    expect(renderBranch('{TASK_KEY}', v)).toBe('PLN-7');
    expect(renderBranch('{USER_LOGIN}/{TASK_KEY}-{TASK_NAME}', v)).toBe('ann/PLN-7-knopka-oprosa');
  });

  it('git ref: пробелы, «..», спецсимволы, «/» и «.» по краям, «.lock»', () => {
    expect(gitRefError('feature/PLN-1')).toBeNull();
    for (const bad of [
      '',
      'a b',
      'a..b',
      'a~b',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      '/a',
      'a/',
      '.a',
      'a.',
      'a.lock',
    ])
      expect(gitRefError(bad), bad).not.toBeNull();
  });

  it('шаблон: только известные поля, скобки сбалансированы, результат — git ref', () => {
    for (const ok of ['{TASK_KEY}', '{USER_LOGIN}/{TASK_KEY}-{TASK_NAME}', 'feature/{TASK_KEY}'])
      expect(branchTemplateError(ok), ok).toBeNull();
    expect(branchTemplateError('{TASK_ID}')).toContain('{TASK_ID}');
    expect(branchTemplateError('{TASK_KEY')).toContain('Незакрытая');
    expect(branchTemplateError('TASK_KEY}')).toContain('Лишняя');
    expect(branchTemplateError('{{TASK_KEY}}')).toContain('Незакрытая');
    expect(branchTemplateError('{TASK_KEY} {TASK_NAME}')).toContain('пробелов');
    expect(branchTemplateError('{TASK_KEY}/')).toContain('недопустимое');
    expect(branchTemplateError('')).toContain('пустое');
  });
});
