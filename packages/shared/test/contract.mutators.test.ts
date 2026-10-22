// Контрактный тест C-mutators: domainMutators = таблица «Мутаторы домена v1». Правит только координатор core.
import { expect, it } from 'vitest';
import { checkMutators } from './check-mutators';

it('contract mutators: реестр domainMutators совпадает с таблицей контракта', () => {
  expect(checkMutators()).toEqual([]);
});
