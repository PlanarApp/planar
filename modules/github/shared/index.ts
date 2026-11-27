import type { SharedModuleManifest } from '@planar/shared';

// PLNRAPP-890: the GitHub connection is a server table only (not synced): no entities, no mutators
export const shared: SharedModuleManifest = { id: 'github', mutators: [], entities: {} };

/** GET /api/github/connection: the token is never returned, neither plain nor encrypted. */
export interface GithubConnectionView {
  login: string;
  connectedBy: string;
  connectedAt: string;
}

export const GITHUB_ERRORS = {
  badToken: 'Токен GitHub недействителен или не имеет доступа',
  unavailable: 'GitHub недоступен, попробуйте позже',
} as const;
