import { z } from 'zod';
import { defineMutator, type EntityName, type SharedModuleManifest, type Tx } from '@planar/shared';

const ts = z.iso.datetime();

export const helloNotes = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  text: z.string(),
  createdAt: ts,
});

// Tx типизирован сущностями ядра; сущности модулей приводим (C-modules)
const modTx = (tx: Tx) => tx as unknown as { put(e: string, row: unknown): Promise<void> };

export const create = defineMutator({
  name: 'hello.create',
  args: z.object({ id: z.uuid(), spaceId: z.uuid(), text: z.string() }),
  async run(tx, a, ctx) {
    await modTx(tx).put('helloNotes' as EntityName, { ...a, createdAt: ctx.now });
  },
});

export const shared: SharedModuleManifest = {
  id: 'hello',
  mutators: [create],
  entities: {
    helloNotes: {
      schema: helloNotes,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId'] },
    },
  },
};
