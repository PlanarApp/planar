import { z } from 'zod';

/** CloudState of the cloud-link contract (docs/contracts/cloud-link.md); validated — it comes from another service. */
export const cloudStateSchema = z.object({
  status: z.enum(['trial', 'active', 'expired']),
  trialEndsAt: z.string().datetime({ offset: true }),
  deleteAfter: z.string().datetime({ offset: true }).nullable(),
  domain: z.string(),
  customDomain: z.string().nullable(),
  serverIp: z.string().nullable(),
  checkout: z.record(z.string(), z.string().url()),
  manageUrl: z.string().nullable(),
});
export type CloudState = z.infer<typeof cloudStateSchema>;

/** Public part, stored in settings `cloud` (synced to everyone: the toolbar badge). notified — trialEndsAt the trial_ending notification was sent for. */
export type CloudPublic = Pick<CloudState, 'status' | 'trialEndsAt'> & { notified?: string };
export const CLOUD_SETTING = 'cloud';

// one process — one instance: the gate is checked on every request without a DB query
let current: CloudPublic | null = null;
export const setCloudPublic = (v: CloudPublic | null) => void (current = v);
export const cloudPublic = () => current;

/** cloud-link: the trial is over or the subscription is canceled. */
export function cloudExpired(now = Date.now()): boolean {
  return (
    !!current &&
    (current.status === 'expired' ||
      (current.status === 'trial' && Date.parse(current.trialEndsAt) <= now))
  );
}

export const DAY = 86400_000;
/** days of trial left, rounded up; null — not a trial */
export const trialDaysLeft = (v: CloudPublic | null, now = Date.now()) =>
  v?.status === 'trial' ? Math.max(0, Math.ceil((Date.parse(v.trialEndsAt) - now) / DAY)) : null;
