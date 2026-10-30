// postMessage bridge v1 (P4-plugins). Plain TS without Vue/SDK: dependencies are passed in, testable without the app.
import { ENTITIES } from '@planar/shared';
import {
  PLUGIN_ENTITIES,
  PLUGIN_MUTATORS,
  type PluginEntity,
  type PluginPermissions,
  type PluginWrite,
} from '../shared/index.js';

export interface BridgePlugin {
  id: string;
  origin: string;
  permissions: PluginPermissions;
}
export type BridgeContext =
  { point: 'taskPanel'; taskId: string; projectId: string; spaceId: string } | { point: 'page' };
export interface BridgeDeps {
  /** rows of the local replica; limit is already ≤ 500 */
  query(q: {
    entity: PluginEntity;
    where: Record<string, unknown>;
    ids?: string[];
    limit: number;
  }): Promise<Record<string, unknown>[]>;
  mutate(pluginId: string, name: string, args: unknown): Promise<void>;
  navigate(path: string): void;
  /** taskPanel only; height is already in 40–2000 */
  resize(height: number): void;
  user: { id: string; name: string; login: string; role: string };
  context: BridgeContext;
  locale: 'ru' | 'en';
  theme: 'light' | 'dark';
}
/** iframe window: postMessage is enough. */
export interface FrameWindow {
  postMessage(msg: unknown, targetOrigin: string): void;
}
export interface MessageLike {
  origin: string;
  source: unknown;
  data: unknown;
}

const KNOWN = new Set(['ready', 'query', 'mutate', 'navigate', 'resize']);
const USER_FIELDS = ['id', 'name', 'login', 'avatarFile'];
export const clampHeight = (h: number): number => Math.min(2000, Math.max(40, Math.round(h)));
/** app path: '/x'; not '//host' and not '/\host' */
export const safePath = (p: unknown): p is string =>
  typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\');

export function createBridge(frame: FrameWindow, plugin: BridgePlugin, deps: BridgeDeps) {
  const send = (msg: Record<string, unknown>) =>
    frame.postMessage({ planar: 1, ...msg }, plugin.origin); // never '*'
  const fail = (id: string, code: string, message: string) =>
    send({ type: 'result', id, ok: false, error: { code, message } });
  const writeNames = new Set(
    plugin.permissions.write.flatMap((w) => PLUGIN_MUTATORS[w as PluginWrite]),
  );

  async function query(m: Record<string, unknown>) {
    const id = m.id as string;
    const entity = m.entity as PluginEntity;
    if (!PLUGIN_ENTITIES.includes(entity)) return fail(id, 'invalid_request', 'entity');
    if (!plugin.permissions.read.includes(entity)) return fail(id, 'forbidden', entity);
    const where = m.where ?? {};
    const allowed = ['id', ...ENTITIES[entity].indexes];
    if (
      typeof where !== 'object' ||
      Array.isArray(where) ||
      Object.keys(where).some((k) => !allowed.includes(k))
    )
      return fail(id, 'invalid_request', 'where');
    const ids = m.ids;
    if (ids !== undefined && !(Array.isArray(ids) && ids.every((x) => typeof x === 'string')))
      return fail(id, 'invalid_request', 'ids');
    const limit = m.limit ?? 100;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500)
      return fail(id, 'invalid_request', 'limit');
    let rows = await deps.query({
      entity,
      where: where as Record<string, unknown>,
      ids: ids as string[] | undefined,
      limit: limit as number,
    });
    rows = rows.slice(0, limit as number);
    if (entity === 'users')
      rows = rows.map((r) => Object.fromEntries(USER_FIELDS.map((k) => [k, r[k]])));
    send({ type: 'result', id, ok: true, rows });
  }

  async function mutate(m: Record<string, unknown>) {
    const id = m.id as string;
    if (typeof m.name !== 'string' || !writeNames.has(m.name))
      return fail(id, 'forbidden', String(m.name));
    await deps.mutate(plugin.id, m.name, m.args);
    send({ type: 'result', id, ok: true });
  }

  /** window 'message' handler. Foreign messages are silently ignored. */
  async function onMessage(e: MessageLike): Promise<void> {
    const m = e.data as Record<string, unknown> | null;
    if (
      e.source !== frame ||
      e.origin !== plugin.origin ||
      !m ||
      typeof m !== 'object' ||
      m.planar !== 1 ||
      typeof m.type !== 'string' ||
      !KNOWN.has(m.type)
    ) {
      console.warn('plugins: сообщение отклонено', e.origin);
      return;
    }
    if (m.type === 'ready')
      return send({
        type: 'init',
        plugin: { id: plugin.id },
        user: deps.user,
        context: deps.context,
        permissions: plugin.permissions,
        locale: deps.locale,
        theme: deps.theme,
      });
    if (m.type === 'navigate') return safePath(m.path) ? deps.navigate(m.path) : undefined;
    if (m.type === 'resize')
      return deps.context.point === 'taskPanel' &&
        typeof m.height === 'number' &&
        isFinite(m.height)
        ? deps.resize(clampHeight(m.height))
        : undefined;
    if (typeof m.id !== 'string') return;
    try {
      await (m.type === 'query' ? query(m) : mutate(m));
    } catch (err) {
      const c = (err as { code?: unknown }).code;
      fail(m.id, typeof c === 'string' ? c : 'internal', (err as Error).message ?? '');
    }
  }
  return { onMessage };
}
