import { expect, it, vi } from 'vitest';
import { createDb } from '../src/db/index.js';

it('an idle client error on the pool does not crash the process', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = createDb('postgres://u@127.0.0.1:1/x');
  expect(() => db.$client.emit('error', new Error('terminating connection'))).not.toThrow();
  expect(log).toHaveBeenCalled();
  log.mockRestore();
  await db.$client.end();
});
