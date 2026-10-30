// Contract test C-mutators: domainMutators = the table «Domain mutators». Only the core coordinator edits this.
import { expect, it } from 'vitest';
import { checkMutators } from './check-mutators';

it('contract mutators: реестр domainMutators совпадает с таблицей контракта', () => {
  expect(checkMutators()).toEqual([]);
});
