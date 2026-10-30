import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type EntityName,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const id = z.uuid();

export const PLUGIN_ENTITIES = [
  'tasks',
  'projects',
  'statuses',
  'labels',
  'users',
  'taskAssignees',
  'taskLabels',
  'comments',
  'checklistItems',
] as const;
export const PLUGIN_WRITES = ['tasks', 'comments', 'checklistItems'] as const;
export type PluginEntity = (typeof PLUGIN_ENTITIES)[number];
export type PluginWrite = (typeof PLUGIN_WRITES)[number];

/** Write rights → allowed mutators (everything else is unavailable to the plugin). */
export const PLUGIN_MUTATORS: Record<PluginWrite, readonly string[]> = {
  tasks: [
    'task.create',
    'task.update',
    'task.assign',
    'task.unassign',
    'task.addLabel',
    'task.removeLabel',
    'task.setField',
  ],
  comments: ['comment.create'],
  checklistItems: ['checklist.add', 'checklist.update', 'checklist.delete'],
};

export const permissionsSchema = z
  .object({
    read: z.array(z.enum(PLUGIN_ENTITIES)).max(20),
    write: z.array(z.enum(PLUGIN_WRITES)).max(10),
  })
  .refine((p) => p.write.every((w) => (p.read as string[]).includes(w)), 'write ⊆ read');
const point = z.object({ label: z.string().min(1).max(100) }).nullable();
export const pointsSchema = z
  .object({ taskPanel: point, page: point })
  .refine((p) => p.taskPanel || p.page, 'нужна хотя бы одна точка');

export type PluginPermissions = z.output<typeof permissionsSchema>;
export type PluginPoints = z.output<typeof pointsSchema>;

/**
 * null — URL is valid, otherwise a reason code. appOrigin '' — the app host is unknown (the scheme check
 * is in the mutator); the server and web pass the real origin.
 */
export function checkPluginUrl(url: string, appOrigin: string, prod: boolean): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'invalid_url';
  }
  if (u.username || u.password) return 'userinfo';
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !prod && local)) return 'scheme';
  if (appOrigin) {
    try {
      // the same host on another port is also a refusal: allow-same-origin is safe only on a foreign host
      if (new URL(appOrigin).hostname === u.hostname) return 'same_host';
    } catch {
      return 'invalid_app_origin';
    }
  }
  return null;
}

export const pluginsPlugins = z.object({
  id,
  name: z.string().min(1).max(100),
  url: z.string().max(2000),
  origin: z.string(),
  permissions: permissionsSchema,
  points: pointsSchema,
  enabled: z.boolean(),
  createdBy: id,
  createdAt: ts,
  updatedAt: ts,
});
export type Plugin = z.output<typeof pluginsPlugins>;

interface MTx {
  get(e: string, id: string): Promise<unknown>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
}
const mtx = (tx: Tx) => tx as unknown as MTx;
const E = 'pluginsPlugins' as EntityName;

export const mutators = [
  defineMutator({
    name: 'plugins.save',
    args: z.object({
      id,
      name: z.string().min(1).max(100),
      url: z.string().max(2000),
      permissions: permissionsSchema,
      points: pointsSchema,
      enabled: z.boolean(),
    }),
    // entity write: server — forbidden for the client, written only by a system call
    async run(tx, a, ctx) {
      // the prod restriction (https only) and the app host are checked by the caller (controller)
      const bad = checkPluginUrl(a.url, '', false);
      if (bad) throw new MutatorError('invalid_args', `url: ${bad}`);
      const t = mtx(tx);
      const prev = (await t.get(E, a.id)) as Plugin | undefined;
      const row = { ...a, origin: new URL(a.url).origin, updatedAt: ctx.now };
      if (prev) await t.patch(E, a.id, row);
      else await t.put(E, { ...row, createdBy: ctx.userId, createdAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'plugins.delete',
    args: z.object({ id }),
    async run(tx, a) {
      await mtx(tx).del(E, a.id);
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'plugins',
  mutators,
  entities: {
    pluginsPlugins: {
      schema: pluginsPlugins,
      meta: { scope: 'global', write: 'server', bootstrap: true, indexes: [] },
    },
  },
};
