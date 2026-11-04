// Set of Tx semantics tests (C-mutators). Mandatory for every Tx implementation:
// MemoryTx (CR-5), server Tx (CR-4). Only the core module coordinator edits this.
//
// Usage: txContractSuite('MemoryTx', async () => ({ tx: new MemoryTx(), spaceId: uuidv7() }));
// setup is called before each test; spaceId — an existing space (for the server Tx —
// created in the same transaction), done — rollback/cleanup after the test.
import { describe, expect, it } from 'vitest';
import { MutatorError, uuidv7, type Row, type Tx } from '../src/index';

export interface TxFixture {
  tx: Tx;
  spaceId: string;
  done?: () => Promise<void>;
}

const T0 = '2026-10-22T10:00:00.000Z';
const T1 = '2026-10-22T11:00:00.000Z';

const label = (spaceId: string, over: Partial<Row<'labels'>> = {}): Row<'labels'> => ({
  id: uuidv7(),
  spaceId,
  projectId: spaceId, // PJ-1: the fixture of a server Tx creates a project with the id of the space
  name: 'bug',
  color: '#f00',
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof MutatorError ? e.code : `throw:${(e as Error).constructor.name}`;
  }
  return 'ok';
}

export function txContractSuite(name: string, setup: () => Promise<TxFixture>) {
  const run = (title: string, fn: (f: TxFixture) => Promise<void>) =>
    it(`tx-contract ${name}: ${title}`, async () => {
      const f = await setup();
      try {
        await fn(f);
      } finally {
        await f.done?.();
      }
    });

  describe(`tx-contract ${name}`, () => {
    run('get отсутствующей строки → undefined', async ({ tx }) => {
      expect(await tx.get('labels', uuidv7())).toBeUndefined();
    });

    run('put → get возвращает ту же строку', async ({ tx, spaceId }) => {
      const r = label(spaceId);
      await tx.put('labels', r);
      expect(await tx.get('labels', r.id)).toEqual(r);
    });

    run('put существующей — полная замена', async ({ tx, spaceId }) => {
      const r = label(spaceId);
      await tx.put('labels', r);
      const r2 = { ...r, name: 'feature', color: '#0f0', updatedAt: T1 };
      await tx.put('labels', r2);
      expect(await tx.get('labels', r.id)).toEqual(r2);
    });

    run('patch меняет только переданные поля, null обнуляет', async ({ tx, spaceId }) => {
      const s: Row<'spaces'> = {
        id: spaceId,
        name: 'S',
        description: 'd',
        color: null,
        icon: null,
        leadId: null,
        rank: 'a0',
        createdBy: uuidv7(),
        createdAt: T0,
        updatedAt: T0,
      };
      const existing = await tx.get('spaces', spaceId);
      if (!existing) await tx.put('spaces', s);
      const before = (await tx.get('spaces', spaceId))!;
      await tx.patch('spaces', spaceId, { name: 'S2', description: null, updatedAt: T1 });
      expect(await tx.get('spaces', spaceId)).toEqual({
        ...before,
        name: 'S2',
        description: null,
        updatedAt: T1,
      });
    });

    run("patch отсутствующей → MutatorError('not_found')", async ({ tx }) => {
      expect(await code(tx.patch('labels', uuidv7(), { name: 'x' }))).toBe('not_found');
    });

    run('del удаляет; del отсутствующей — без ошибки', async ({ tx, spaceId }) => {
      const r = label(spaceId);
      await tx.put('labels', r);
      await tx.del('labels', r.id);
      expect(await tx.get('labels', r.id)).toBeUndefined();
      expect(await code(tx.del('labels', r.id))).toBe('ok');
    });

    run('scan по индексу возвращает ровно совпадающие', async ({ tx, spaceId }) => {
      const a = label(spaceId, { name: 'a' });
      const b = label(spaceId, { name: 'b' });
      await tx.put('labels', a);
      await tx.put('labels', b);
      const got = await tx.scan('labels', { index: 'spaceId', eq: spaceId });
      expect(got.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
      expect(await tx.scan('labels', { index: 'spaceId', eq: uuidv7() })).toEqual([]);
    });

    run('scan видит запись той же транзакции после patch и del', async ({ tx, spaceId }) => {
      const a = label(spaceId);
      const b = label(spaceId);
      await tx.put('labels', a);
      await tx.put('labels', b);
      await tx.patch('labels', a.id, { name: 'renamed' });
      await tx.del('labels', b.id);
      const got = await tx.scan('labels', { index: 'spaceId', eq: spaceId });
      expect(got.map((r) => [r.id, r.name])).toEqual([[a.id, 'renamed']]);
    });

    run('scan по полю не из indexes → throw', async ({ tx, spaceId }) => {
      expect(await code(tx.scan('labels', { index: 'name', eq: 'bug' }))).not.toBe('ok');
      void spaceId;
    });

    run("put невалидной строки → MutatorError('invalid_args')", async ({ tx, spaceId }) => {
      const bad = { ...label(spaceId), color: 42 } as unknown as Row<'labels'>;
      expect(await code(tx.put('labels', bad))).toBe('invalid_args');
      const missing: Partial<Row<'labels'>> = label(spaceId);
      delete missing.name;
      expect(await code(tx.put('labels', missing as Row<'labels'>))).toBe('invalid_args');
    });

    run(
      "patch, дающий невалидную строку → MutatorError('invalid_args')",
      async ({ tx, spaceId }) => {
        const r = label(spaceId);
        await tx.put('labels', r);
        expect(
          await code(tx.patch('labels', r.id, { name: null } as unknown as Partial<Row<'labels'>>)),
        ).toBe('invalid_args');
        expect(await tx.get('labels', r.id)).toEqual(r);
      },
    );

    run('get возвращает копию: правка результата не меняет хранилище', async ({ tx, spaceId }) => {
      const r = label(spaceId);
      await tx.put('labels', r);
      const got = (await tx.get('labels', r.id))!;
      got.name = 'mutated';
      expect((await tx.get('labels', r.id))!.name).toBe('bug');
    });
  });
}
