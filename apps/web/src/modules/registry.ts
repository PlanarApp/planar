import { computed, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { liveQuery } from 'dexie';
import { isDataModule } from '@planar/shared';
import { router } from '../router';
import { db, replicaState } from '../sync';
import type { ExtensionKind, WebModuleManifest } from './types';

export type Extension<K extends ExtensionKind> = NonNullable<WebModuleManifest[K]>[number] & {
  moduleId: string;
  key: string;
};

const registered = shallowRef<WebModuleManifest[]>([]);

/** null — not yet known (replica hasn't bootstrapped): show all registered, ensureModule waits */
const enabled = shallowRef<string[] | null>(null);
const timedOut = shallowRef(false);
/** projectId → data modules enabled there (projects.modules of the replica); null — projects not read yet (C-schema v16) */
const projectMods = shallowRef<Map<string, string[]> | null>(null);
/** enabled modules whose frontend was not found or did not load */
const failed = shallowRef<string[]>([]);
const fail = (id: string) => void (failed.value = [...failed.value, id]);
/** Module settings already read from the replica. */
export const modulesKnown = (): boolean => !!enabled.value;
const SETTINGS_WAIT_MS = 10_000;

/** Module state for the screen: loading — settings not yet read, off — disabled, error — not awaited / not loaded. */
export const moduleStatus = (id: string): 'loading' | 'off' | 'ready' | 'error' =>
  !enabled.value
    ? timedOut.value
      ? 'error'
      : 'loading'
    : !enabled.value.includes(id)
      ? 'off'
      : registered.value.some((m) => m.id === id)
        ? 'ready'
        : failed.value.includes(id)
          ? 'error'
          : 'loading';

/**
 * Is the module on for the project (C-schema v16). A shared module — instance-wide; a data module — by
 * `projects.modules`; without a project (summaries) — on in at least one of the projects. Before the replica is
 * read — by the module list alone, like before.
 */
export function enabledForProject(moduleId: string, projectId?: string | string[]): boolean {
  if (enabled.value && !enabled.value.includes(moduleId)) return false;
  if (!isDataModule(moduleId) || !projectMods.value) return true;
  const ids = projectId === undefined ? [...projectMods.value.keys()] : [projectId].flat();
  return ids.some((id) => projectMods.value!.get(id)?.includes(moduleId));
}

/** Waits until enabled becomes known; false — not awaited within SETTINGS_WAIT_MS. */
function settingsKnown(): Promise<boolean> {
  if (enabled.value) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop();
      timedOut.value = true;
      console.warn('Настройки модулей не загрузились');
      resolve(false);
    }, SETTINGS_WAIT_MS);
    const stop = watch(enabled, (v) => {
      if (!v) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    });
  });
}
type Loaders = Record<string, () => Promise<{ web: WebModuleManifest }>>;
let loaders: Loaders = import.meta.glob<{ web: WebModuleManifest }>(
  '../../../../modules/*/web/index.ts',
);

export function registerModules(all: WebModuleManifest[]): void {
  // repeated registration of the same moduleId — no duplicates
  const manifests = all.filter((m) => !registered.value.some((r) => r.id === m.id));
  // check everything before changing state
  const keys = new Set<string>();
  for (const m of [...registered.value, ...manifests]) {
    for (const kind of [
      'views',
      'taskPanels',
      'docPanels',
      'commands',
      'fieldTypes',
      'settings',
      'nav',
      'topbar',
      'search',
      'groupTabs',
    ] as const) {
      for (const it of m[kind] ?? []) {
        const key = `${m.id}:${it.id}`;
        if (keys.has(`${kind}/${key}`)) throw new Error(`Дубликат элемента модуля: ${key}`);
        keys.add(`${kind}/${key}`);
      }
    }
  }
  for (const m of manifests) {
    for (const r of m.routes ?? []) {
      if (!r.path.startsWith(`/m/${m.id}/`))
        throw new Error(`Маршрут ${r.path} модуля ${m.id} вне /m/${m.id}/`);
    }
    for (const n of m.nav ?? []) {
      if ('section' in n) continue;
      if (!n.to?.startsWith(`/m/${m.id}/`))
        throw new Error(`Пункт nav ${m.id}:${n.id} без section и с to вне /m/${m.id}/`);
    }
  }
  registered.value = [...registered.value, ...manifests];
  for (const m of manifests) for (const r of m.routes ?? []) router.addRoute(r);
}

/** Enabled modules (settings.enabled_modules): loads the frontend of not-yet-registered ones. */
/** Tests only: replace the glob loaders. */
export const setModuleLoaders = (l: Loaders): void => void (loaders = l);

/** Lazily loads only module `id` (direct entry to /m/<id>/…); false — disabled or not found. */
export async function ensureModule(id: string): Promise<boolean> {
  if (!(await settingsKnown())) return false;
  if (!enabled.value!.includes(id)) return false;
  if (registered.value.some((m) => m.id === id)) return true;
  const load = Object.entries(loaders).find(([path]) => path.split('/').at(-3) === id)?.[1];
  if (!load) return (fail(id), false);
  try {
    registerModules([(await load()).web]);
    return true;
  } catch (e) {
    console.warn(`Модуль ${id} не загрузился`, e);
    fail(id);
    return false;
  }
}

/** Module setup component (including disabled): loads its web part without registering; none — undefined. */
export async function moduleSetup(
  id: string,
): Promise<NonNullable<WebModuleManifest['setup']> | undefined> {
  const load = Object.entries(loaders).find(([path]) => path.split('/').at(-3) === id)?.[1];
  try {
    return (await load?.())?.web.setup;
  } catch (e) {
    console.warn(`Модуль ${id} не загрузился`, e);
    return undefined;
  }
}

export async function setEnabledModules(ids: string[]): Promise<void> {
  enabled.value = ids;
  const todo = Object.entries(loaders).filter(([path]) => {
    const id = path.split('/').at(-3)!;
    return ids.includes(id) && !registered.value.some((m) => m.id === id);
  });
  const loaded = await Promise.all(
    todo.map(([path, load]) =>
      load().then(
        (m) => m.web,
        (e) => {
          console.warn(`Модуль ${path} не загрузился`, e);
          fail(path.split('/').at(-3)!);
        },
      ),
    ),
  );
  registerModules(loaded.filter((m): m is WebModuleManifest => !!m));
}

/**
 * Watches settings.enabled_modules (shared modules) and projects.modules (data modules) in the replica;
 * the frontend of a data module is loaded when it is on in at least one project. Call from main.ts once.
 */
export function initModules(): void {
  let shared: string[] | null = null;
  const refresh = () => {
    if (!shared || !projectMods.value) return;
    const data = new Set([...projectMods.value.values()].flat());
    void setEnabledModules([...shared, ...data]);
  };
  // empty replica (before bootstrap) — "unknown", not "all disabled"
  const apply = (r: { value?: unknown } | undefined) => {
    if (r || replicaState.value !== 'empty') {
      shared = Array.isArray(r?.value) ? (r.value as string[]) : [];
      refresh();
    }
  };
  const applyProjects = (rows: { id: string; modules?: string[] }[]) => {
    if (!rows.length && replicaState.value === 'empty') return;
    projectMods.value = new Map(rows.map((p) => [p.id, p.modules ?? []]));
    refresh();
  };
  liveQuery(() => db.table('settings').get('enabled_modules')).subscribe({
    next: apply,
    error: () => {},
  });
  liveQuery(() => db.table('projects').toArray()).subscribe({
    next: applyProjects,
    error: () => {},
  });
  // bootstrap without a settings row: reread when the replica stops being empty
  watch(replicaState, async (st) => {
    if (st === 'empty') return;
    apply(await db.table('settings').get('enabled_modules'));
    applyProjects(await db.table('projects').toArray());
  });
}

/** `projectId` — the project (or the projects of a summary) whose items are shown; without it — items of modules on in any project. */
export function useExtensions<K extends ExtensionKind>(
  kind: K,
  projectId?: MaybeRefOrGetter<string | string[] | undefined>,
): ComputedRef<Extension<K>[]> {
  return computed(() => {
    const pid = toValue(projectId);
    const out = registered.value
      .filter((m) => !enabled.value || enabled.value.includes(m.id))
      .filter((m) => enabledForProject(m.id, pid))
      .flatMap((m) =>
        ((m[kind] ?? []) as { id: string }[]).map((it) => ({
          ...it,
          moduleId: m.id,
          key: `${m.id}:${it.id}`,
        })),
      ) as unknown as Extension<K>[];
    if (
      kind === 'taskPanels' ||
      kind === 'docPanels' ||
      kind === 'nav' ||
      kind === 'topbar' ||
      kind === 'groupTabs'
    )
      out.sort(
        (a, b) =>
          ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0) ||
          a.key.localeCompare(b.key),
      );
    return out;
  });
}
