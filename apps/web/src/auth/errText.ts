import { ApiError } from '../api/http';

export function errText(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_credentials') return t('auth.invalidCredentials');
    if (e.code === 'rate_limited') return t('auth.rateLimited');
    if (e.code === 'network') return t('auth.network');
  }
  return t('auth.failed');
}
