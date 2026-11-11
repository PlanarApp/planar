import type { SharedModuleManifest } from '@planar/shared';

/** The bot user: login and display name (PLNRAPP-167). */
export const AI_BOT_LOGIN = 'ai';
export const AI_BOT_NAME = 'ИИ';

export const AI_PROVIDERS = ['openai', 'anthropic', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_SCOPES = ['instance', 'space', 'project'] as const;
export type AiScope = (typeof AI_SCOPES)[number];
/** scopeId of the instance level (the column is not null: one connection per level) */
export const INSTANCE_SCOPE_ID = '00000000-0000-0000-0000-000000000000';

/** Connection as the client sees it: the key is never returned, only whether it is set. */
export interface AiConnectionView {
  id: string;
  scope: AiScope;
  scopeId: string;
  provider: AiProvider;
  baseUrl: string | null;
  model: string;
  /** USD per 1M tokens; null — unknown, cost is not counted */
  priceIn: number | null;
  priceOut: number | null;
  keySet: true;
  updatedAt: string;
}

// No synced entities yet: connections are a server table outside the module gate (ai_connections).
export const shared: SharedModuleManifest = {
  id: 'ai',
  mutators: [],
  entities: {},
};
