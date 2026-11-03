import { isDataModule } from '@planar/shared';
import { api } from './http';

/** Data modules a new project starts with (PJ-14): available ones from /api/modules; undefined if the list is not loaded. */
export async function defaultModules(): Promise<string[] | undefined> {
  try {
    const { modules } = await api<{ modules: { id: string; unavailable?: string | null }[] }>(
      'GET',
      '/api/modules',
    );
    return modules.filter((m) => isDataModule(m.id) && m.unavailable == null).map((m) => m.id);
  } catch {
    return undefined;
  }
}
