import { computed } from 'vue';
import { useExtensions } from '../modules/registry';

/** Documents can be picked when the docs module (its search provider) is on. */
export function useDocsPickable() {
  const providers = useExtensions('search');
  return computed(() => providers.value.some((p) => p.moduleId === 'docs'));
}
