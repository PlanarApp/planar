import { isDataModule, WORKSPACE_DATA_MODULE_IDS } from '@planar/shared';
import { api } from './http';

/** Data modules a new project starts with (PJ-14): available ones from /api/modules; undefined if the list is not loaded. */
export async function defaultModules(): Promise<string[] | undefined> {
  try {
    const { modules } = await api<{
      modules: { id: string; enabled: boolean; unavailable?: string | null }[];
    }>('GET', '/api/modules');
    // PLNRAPP-241: a module with a workspace switch — only when it is on in the workspace
    return modules
      .filter(
        (m) =>
          isDataModule(m.id) &&
          m.unavailable == null &&
          (m.enabled || !WORKSPACE_DATA_MODULE_IDS.includes(m.id)),
      )
      .map((m) => m.id);
  } catch {
    return undefined;
  }
}
