import type { SharedModuleManifest } from '@planar/shared';

// PLNRAPP-890: GitHub connections are server tables only (not synced): no entities, no mutators
export const shared: SharedModuleManifest = { id: 'github', mutators: [], entities: {} };

/** scopeId of the workspace level (as in modules/gitlab). */
export const WORKSPACE_SCOPE_ID = '00000000-0000-0000-0000-000000000000';
/** Connection levels, as in modules/gitlab: a space / project uses its own connection or a parent's. */
export type GithubScope = 'workspace' | 'space' | 'project';

/** A github.com connection for the client: the token is never returned, neither plain nor encrypted. */
export interface GithubConnectionView {
  id: string;
  scope: GithubScope;
  scopeId: string;
  login: string;
  connectedBy: string;
  connectedAt: string;
}

/** GET /api/github/levels/:scope/:scopeId */
export interface GithubLevelView {
  /** own connections of the level and those of the levels above */
  connections: GithubConnectionView[];
  /** the level's own choice; null — inherits */
  choice: string | null;
  /** the connection in force for the level; null — none */
  effective: string | null;
}

export const GITHUB_ERRORS = {
  badToken: 'Токен GitHub недействителен или не имеет доступа',
  unavailable: 'GitHub недоступен, попробуйте позже',
  notConnected: 'Подключение GitHub не настроено',
  repoNotFound: 'Репозиторий не найден в GitHub или недоступен по токену подключения',
} as const;

/** PLNRAPP-891: a repository the project's connection has access to (GET /api/github/projects/:id/available). */
export interface GithubRepoOption {
  repoId: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** GET /api/github/projects/:projectId/available — connected: false — no connection for the project. */
export interface GithubAvailableView {
  connected: boolean;
  repos: GithubRepoOption[];
}

/** PLNRAPP-891: a project's bound repository. */
export interface GithubRepoView {
  id: string;
  projectId: string;
  connectionId: string;
  repoId: number;
  fullName: string;
  defaultBranch: string;
}
