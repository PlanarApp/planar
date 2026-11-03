// PJ-14: project.create modules (C-mutators v13)
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSIONS } from '../../src/index';
import { code, id, mem, run, seedSpace } from './helpers';

describe('PJ-14: project.create modules', () => {
  const create = (tx: ReturnType<typeof mem>, spaceId: string, extra: object, pid = id()) =>
    run(tx, 'project.create', {
      id: pid,
      spaceId,
      name: 'P',
      key: 'PQ',
      rank: 'a9',
      statusIds: Array.from({ length: 5 }, () => id()),
      ...extra,
    }).then(() => pid);

  it('PJ-14 modules сохраняются без дублей; без аргумента — []', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const a = await create(tx, s.spaceId, { modules: ['time', 'docs', 'time'] });
    expect((await tx.get('projects', a))!.modules).toEqual(['time', 'docs']);
    const b = await create(tx, s.spaceId, {});
    expect((await tx.get('projects', b))!.modules).toEqual([]);
  });

  it('PJ-14 общий или неизвестный модуль → invalid_args', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    for (const m of ['chat', 'nope'])
      expect(await code(create(tx, s.spaceId, { modules: [m] }))).toBe('invalid_args');
  });

  it('PJ-14 версия C-mutators не ниже 13', () => {
    expect(CONTRACT_VERSIONS['C-mutators']).toBeGreaterThanOrEqual(13);
  });
});
