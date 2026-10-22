import { computed, shallowRef, type ComputedRef } from 'vue';
import { router } from '../router';
import type { ExtensionKind, WebModuleManifest } from './types';

export type Extension<K extends ExtensionKind> = NonNullable<WebModuleManifest[K]>[number] & {
  moduleId: string;
  key: string;
};

const registered = shallowRef<WebModuleManifest[]>([]);

export function registerModules(manifests: WebModuleManifest[]): void {
  // проверка целиком до изменения состояния
  const keys = new Set<string>();
  for (const m of [...registered.value, ...manifests]) {
    for (const kind of ['views', 'taskPanels', 'commands', 'fieldTypes', 'settings'] as const) {
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
  }
  registered.value = [...registered.value, ...manifests];
  for (const m of manifests) for (const r of m.routes ?? []) router.addRoute(r);
}

export function useExtensions<K extends ExtensionKind>(kind: K): ComputedRef<Extension<K>[]> {
  // до WB-10 — все зарегистрированные модули
  return computed(() => {
    const out = registered.value.flatMap((m) =>
      ((m[kind] ?? []) as { id: string }[]).map((it) => ({
        ...it,
        moduleId: m.id,
        key: `${m.id}:${it.id}`,
      })),
    ) as unknown as Extension<K>[];
    if (kind === 'taskPanels')
      out.sort(
        (a, b) =>
          ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0) ||
          a.key.localeCompare(b.key),
      );
    return out;
  });
}
