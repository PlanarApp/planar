import { api } from './http';

export type TokenScope = 'read' | 'write';
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scope: TokenScope;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const listTokens = () => api<{ tokens: ApiToken[] }>('GET', '/api/tokens');
export const createToken = (b: { name: string; scope: TokenScope; expiresAt: string | null }) =>
  api<{ token: ApiToken; secret: string }>('POST', '/api/tokens', b);
export const revokeToken = (id: string) => api<void>('DELETE', `/api/tokens/${id}`);
