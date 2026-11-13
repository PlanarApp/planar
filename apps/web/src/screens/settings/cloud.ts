import { useI18n } from 'vue-i18n';
import { ApiError } from '../../api/http';

/** CloudState of docs/contracts/cloud-link.md */
export type CloudState = {
  status: 'trial' | 'active' | 'expired';
  trialEndsAt: string;
  deleteAfter: string | null;
  domain: string;
  customDomain: string | null;
  serverIp: string | null;
  checkout: Record<string, string>;
  manageUrl: string | null;
  // v2: AI tariff
  ai: boolean;
  aiReplicas: number | null;
  aiPaid: boolean;
  llm: { key: string; credits: number; baseUrl?: string } | null;
  addons: {
    ai: { replicas: number; usd: number; checkout: Record<string, string> }[];
    credits: { credits: number; usd: number; checkout: Record<string, string> }[];
  };
};

/** the typed confirmation matches the instance name: spaces and case don't matter (the cloud is sent the name itself) */
export const nameTyped = (typed: string, name: string) =>
  !!name && typed.trim().toLowerCase() === name.toLowerCase();

/** cloud error codes come in details.cloud (h3 statusMessage of planar-cloud) */
export function useCloudErrors(ip: () => string | null | undefined) {
  const { t, te } = useI18n();
  return (e: unknown) => {
    if (!(e instanceof ApiError)) return t('auth.failed');
    const det = e.details as { cloud?: string; data?: unknown } | undefined;
    const key = `cloud.err.${det?.cloud ?? e.code}`;
    return te(key) ? t(key, { ip: String(det?.data ?? ip() ?? '') }) : e.message;
  };
}
