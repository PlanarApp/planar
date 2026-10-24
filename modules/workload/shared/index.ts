import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type EntityName,
  type SharedModuleManifest,
} from '@planar/shared';

export const workloadCapacities = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  userId: z.uuid(),
  hoursPerWeek: z.number().int().min(0).max(168),
  updatedBy: z.uuid(),
  updatedAt: z.iso.datetime(),
});
export type WorkloadCapacity = z.output<typeof workloadCapacities>;

// Tx типизирован сущностями ядра; сущности модулей приводим (C-modules)
interface MTx {
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan(e: string, o: { index: string; eq: unknown }): Promise<unknown[]>;
}
const E = 'workloadCapacities' as EntityName;

export const mutators = [
  defineMutator({
    name: 'workload.setCapacity',
    args: z.object({
      id: z.uuid(),
      spaceId: z.uuid(),
      userId: z.uuid(),
      hoursPerWeek: z.number().int().min(0).max(168).nullable(),
    }),
    async run(tx, a, ctx) {
      const members = await tx.scan('spaceMembers', { index: 'spaceId', eq: a.spaceId });
      if (!members.some((m) => m.userId === a.userId))
        throw new MutatorError('invalid_args', 'userId не участник пространства');
      const m = tx as unknown as MTx;
      const old = (
        (await m.scan(E, { index: 'spaceId', eq: a.spaceId })) as WorkloadCapacity[]
      ).find((c) => c.userId === a.userId);
      if (a.hoursPerWeek === null) {
        if (old) await m.del(E, old.id);
        return;
      }
      const upd = { hoursPerWeek: a.hoursPerWeek, updatedBy: ctx.userId, updatedAt: ctx.now };
      if (old) await m.patch(E, old.id, upd);
      else await m.put(E, { id: a.id, spaceId: a.spaceId, userId: a.userId, ...upd });
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'workload',
  mutators,
  entities: {
    workloadCapacities: {
      schema: workloadCapacities,
      meta: { scope: 'space', write: 'admin', bootstrap: true, indexes: ['spaceId', 'userId'] },
    },
  },
};
