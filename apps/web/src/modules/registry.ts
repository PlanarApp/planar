import { computed, shallowRef, watch, type ComputedRef } from 'vue';
import { liveQuery } from 'dexie';
import { router } from '../router';
import { db, replicaState } from '../sync';
import type { ExtensionKind, WebModuleManifest } from './types';

export type Extension<K extends ExtensionKind> = NonNullable<WebModuleManifest[K]>[number] & {
  moduleId: string;
  key: string;
};

const registered = shallowRef<WebModuleManifest[]>([]);

/** null — ещё не известно (реплика не прошла bootstrap): показываем все зарегистрированные, ensureModule ждёт */
const enabled = shallowRef<string[] | null>(null);
let timedOut = false;
const SETTINGS_WAIT_MS = 10_000;

/** Состояние модуля для экрана: loading — настройки ещё не прочитаны, off — выключен, error — не дождались/не загрузился. */
export const moduleStatus = (id: string): 'loading' | 'off' | 'ready' | 'error' =>
  !enabled.value
    ? timedOut
      ? 'error'
      : 'loading'
    : !enabled.value.includes(id)
      ? 'off'
      : registered.value.some((m) => m.id === id)
        ? 'ready'
        : 'loading';

/** Ждёт, пока enabled станет известен; false — не дождались за SETTINGS_WAIT_MS. */
function settingsKnown(): Promise<boolean> {
  if (enabled.value) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop();
      timedOut = true;
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
  // повторная регистрация того же moduleId — без дубликатов
  const manifests = all.filter((m) => !registered.value.some((r) => r.id === m.id));
  // проверка целиком до изменения состояния
  const keys = new Set<string>();
  for (const m of [...registered.value, ...manifests]) {
    for (const kind of [
      'views',
      'taskPanels',
      'commands',
      'fieldTypes',
      'settings',
      'nav',
      'topbar',
      'search',
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

/** Включённые модули (settings.enabled_modules): подгружает фронт ещё не зарегистрированных. */
/** Только для тестов: подменить glob-загрузчики. */
export const setModuleLoaders = (l: Loaders): void => void (loaders = l);

/** Лениво грузит только модуль `id` (прямой заход на /m/<id>/…); false — выключен или не найден. */
export async function ensureModule(id: string): Promise<boolean> {
  if (!(await settingsKnown())) return false;
  if (!enabled.value!.includes(id)) return false;
  if (registered.value.some((m) => m.id === id)) return true;
  const load = Object.entries(loaders).find(([path]) => path.split('/').at(-3) === id)?.[1];
  if (!load) return false;
  try {
    registerModules([(await load()).web]);
    return true;
  } catch (e) {
    console.warn(`Модуль ${id} не загрузился`, e);
    return false;
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
        (e) => void console.warn(`Модуль ${path} не загрузился`, e),
      ),
    ),
  );
  registerModules(loaded.filter((m): m is WebModuleManifest => !!m));
}

/** Следит за settings.enabled_modules в реплике; вызывать из main.ts один раз. */
export function initModules(): void {
  // пустая реплика (до bootstrap) — «неизвестно», а не «все выключены»
  const apply = (r: { value?: unknown } | undefined) => {
    if (r || replicaState.value !== 'empty')
      void setEnabledModules(Array.isArray(r?.value) ? (r.value as string[]) : []);
  };
  liveQuery(() => db.table('settings').get('enabled_modules')).subscribe({
    next: apply,
    error: () => {},
  });
  // bootstrap без строки настроек: перечитать, когда реплика перестала быть пустой
  watch(replicaState, async (st) => {
    if (st !== 'empty') apply(await db.table('settings').get('enabled_modules'));
  });
}

export function useExtensions<K extends ExtensionKind>(kind: K): ComputedRef<Extension<K>[]> {
  return computed(() => {
    const out = registered.value
      .filter((m) => !enabled.value || enabled.value.includes(m.id))
      .flatMap((m) =>
        ((m[kind] ?? []) as { id: string }[]).map((it) => ({
          ...it,
          moduleId: m.id,
          key: `${m.id}:${it.id}`,
        })),
      ) as unknown as Extension<K>[];
    if (kind === 'taskPanels' || kind === 'nav' || kind === 'topbar')
      out.sort(
        (a, b) =>
          ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0) ||
          a.key.localeCompare(b.key),
      );
    return out;
  });
}
