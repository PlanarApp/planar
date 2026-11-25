import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './http';

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
export interface Security {
  totp: boolean;
  recoveryLeft: number;
  passkeys: Passkey[];
  /** null — off; 0 — on every open; N — after N minutes of inactivity */
  lockMinutes: number | null;
  lockWipe: boolean;
  /** 2FA is required by the instance policy */
  required: boolean;
  /** the session waits for the first factor (policy) */
  setup: boolean;
}
/** Second factor: a TOTP/recovery code or a passkey assertion */
export type Proof = { code: string } | { challengeId: string; response: unknown };

export const getSecurity = () => api<Security>('GET', '/api/auth/security');
export const totpSetup = () =>
  api<{ secret: string; uri: string; qr: string }>('POST', '/api/auth/totp/setup');
export const totpEnable = (code: string) =>
  api<{ recoveryCodes: string[] }>('POST', '/api/auth/totp/enable', { code });
export const totpDisable = (code: string) => api<void>('POST', '/api/auth/totp/disable', { code });
export const newRecoveryCodes = (p: Proof) =>
  api<{ recoveryCodes: string[] }>('POST', '/api/auth/recovery-codes', p);
export const setLock = (b: { lockMinutes: number | null; lockWipe: boolean }) =>
  api('PATCH', '/api/auth/lock', b);
export const deletePasskey = (id: string) =>
  api<void>('DELETE', `/api/auth/passkeys/${encodeURIComponent(id)}`);

export const passkeySupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential;

/** Browser dialog (biometrics / device PIN) → new key on the server */
export async function addPasskey(name: string): Promise<Passkey> {
  const { challengeId, options } = await api<{ challengeId: string; options: never }>(
    'POST',
    '/api/auth/passkeys/options',
  );
  const response = await startRegistration({ optionsJSON: options });
  return api<Passkey>('POST', '/api/auth/passkeys', { challengeId, response, name });
}

/** Passkey assertion for sign-in, the second factor or unlock */
export async function passkeyProof(): Promise<Proof> {
  const { challengeId, options } = await api<{ challengeId: string; options: never }>(
    'POST',
    '/api/auth/passkey/options',
  );
  return { challengeId, response: await startAuthentication({ optionsJSON: options }) };
}

/** Passkey name by default: the platform of this device */
export const deviceName = () =>
  (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
  navigator.platform ||
  'Passkey';
