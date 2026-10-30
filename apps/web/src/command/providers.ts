import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { LocalizedText, SearchHit, SearchProviderDef } from '../modules/types';

export interface ProviderGroup {
  key: string;
  label: string;
  hits: SearchHit[];
}
export const PROVIDER_LIMIT = 5;
export const PROVIDER_DEBOUNCE_MS = 150;
export const PROVIDER_TIMEOUT_MS = 2000;

type Provider = SearchProviderDef & { key: string };

/** Search provider groups; provider error or empty response — group hidden. */
export async function queryProviders(
  providers: Provider[],
  q: string,
  label: (l: LocalizedText) => string,
): Promise<ProviderGroup[]> {
  const out = await Promise.all(
    providers.map(async (p): Promise<ProviderGroup | null> => {
      try {
        const hits = (
          await Promise.race([
            p.search(q, PROVIDER_LIMIT),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error('timeout')), PROVIDER_TIMEOUT_MS),
            ),
          ])
        ).slice(0, PROVIDER_LIMIT);
        return hits.length ? { key: p.key, label: label(p.label), hits } : null;
      } catch {
        return null;
      }
    }),
  );
  return out.filter((g): g is ProviderGroup => !!g);
}

/** Reactive groups by query: debounce 150 ms, stale response discarded. */
export function useProviderGroups(
  query: Ref<string>,
  providers: () => Provider[],
  label: (l: LocalizedText) => string,
): Ref<ProviderGroup[]> {
  const groups = ref<ProviderGroup[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let n = 0;
  watch([query, providers], () => {
    clearTimeout(timer);
    const q = query.value.trim();
    const ps = providers();
    const my = ++n;
    if (!q || !ps.length) {
      groups.value = [];
      return;
    }
    timer = setTimeout(async () => {
      const r = await queryProviders(ps, q, label);
      if (my === n) groups.value = r;
    }, PROVIDER_DEBOUNCE_MS);
  });
  onScopeDispose(() => clearTimeout(timer));
  return groups;
}
