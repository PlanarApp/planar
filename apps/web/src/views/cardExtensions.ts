import { computed, defineAsyncComponent, type Component } from 'vue';
import { useExtensions } from '../modules/registry';

const cache = new Map<string, Component>();

/** Module task panels with `card: true` (time tracking): shown on every task card/row of the views,
 * only where the module is enabled for the task's project. One async component per panel for all cards. */
export function useCardExtensions(projectId: () => string) {
  const ext = useExtensions('taskPanels', projectId);
  return computed(() =>
    ext.value
      .filter((p) => p.card)
      .map((p) => {
        if (!cache.has(p.key))
          cache.set(
            p.key,
            defineAsyncComponent(() => p.component().then((m) => m.default)),
          );
        return { key: p.key, view: cache.get(p.key)! };
      }),
  );
}
