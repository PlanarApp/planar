import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type EntityName,
  type SharedModuleManifest,
} from '@planar/shared';

const id = z.uuid();

export const emailPrefs = z.object({
  id,
  userId: id,
  notify: z.boolean(),
  digest: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type EmailPrefs = z.output<typeof emailPrefs>;

// Tx типизирован сущностями ядра; сущности модулей приводим (C-modules)
interface MTx {
  get(e: string, id: string): Promise<EmailPrefs | undefined>;
  put(e: string, row: EmailPrefs): Promise<void>;
}

export const mutators = [
  defineMutator({
    name: 'email.setPrefs',
    args: z.object({ id, notify: z.boolean().optional(), digest: z.boolean().optional() }),
    async run(tx, a, ctx) {
      // системная отписка идёт от имени владельца токена (CoreServices.execute), так что id = userId
      if (a.id !== ctx.userId) throw new MutatorError('forbidden', 'чужие настройки почты');
      const t = tx as unknown as MTx;
      const old = await t.get('emailPrefs' as EntityName, a.id);
      await t.put('emailPrefs' as EntityName, {
        id: a.id,
        userId: a.id,
        notify: a.notify ?? old?.notify ?? true,
        digest: a.digest ?? old?.digest ?? false,
        updatedAt: ctx.now,
      });
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'email',
  mutators,
  entities: {
    emailPrefs: {
      schema: emailPrefs,
      meta: { scope: 'user', write: 'self', bootstrap: true, indexes: [] },
    },
  },
};
