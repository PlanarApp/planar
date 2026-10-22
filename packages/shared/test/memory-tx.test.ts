import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/index';
import { MemoryTx } from '../src/testing/index';
import { txContractSuite } from './tx-contract';

txContractSuite('MemoryTx', async () => ({ tx: new MemoryTx(), spaceId: uuidv7() }));

describe('MemoryTx: дополнительно', () => {
  const lab = (spaceId: string) => ({
    id: uuidv7(),
    spaceId,
    name: 'a',
    color: '#000',
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
  });

  it('scan без opts — все строки', async () => {
    const tx = new MemoryTx();
    await tx.put('labels', lab(uuidv7()));
    await tx.put('labels', lab(uuidv7()));
    expect(await tx.scan('labels')).toHaveLength(2);
  });

  it('put сохраняет копию: правка исходного объекта не влияет', async () => {
    const tx = new MemoryTx();
    const r = lab(uuidv7());
    await tx.put('labels', r);
    r.name = 'changed';
    expect((await tx.get('labels', r.id))!.name).toBe('a');
  });

  it('scan отдаёт копии', async () => {
    const tx = new MemoryTx();
    const r = lab(uuidv7());
    await tx.put('labels', r);
    (await tx.scan('labels'))[0].name = 'x';
    expect((await tx.get('labels', r.id))!.name).toBe('a');
  });

  it('patch игнорирует undefined', async () => {
    const tx = new MemoryTx();
    const r = lab(uuidv7());
    await tx.put('labels', r);
    await tx.patch('labels', r.id, { name: undefined, color: '#fff' });
    expect(await tx.get('labels', r.id)).toEqual({ ...r, color: '#fff' });
  });
});
