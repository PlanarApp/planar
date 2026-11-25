import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { BASE, Client } from '../lib.js';
import { pick, uniq } from './helpers.js';

// 2FA in a real browser: passkey via the Chromium virtual authenticator (biometrics → isUserVerified), TOTP, app lock

function totp(secret: string, step = Math.floor(Date.now() / 30_000)): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let v = 0;
  const key: number[] = [];
  for (const c of secret) {
    v = (v << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      key.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function signIn(page: Page, login: string) {
  await page.goto('/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(login);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}

const signOut = async (page: Page) => {
  await page.request.post('/api/auth/logout', { headers: { origin: BASE } });
  await page.goto('/login');
};

test('passkey, блокировка при открытии, вход без пароля, TOTP вторым фактором', async ({
  browser,
}) => {
  const admin = await Client.login('admin');
  const login = uniq('mfa').replace(/\W/g, '').toLowerCase();
  const r = await admin.ctx.post('/api/users', {
    data: { login, name: 'MFA', password: login, role: 'member' },
  });
  expect(r.ok()).toBe(true);

  const ctx = await browser.newContext({ baseURL: BASE, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await signIn(page, login);
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.goto('/profile?tab=security');
  await page.getByTestId('add-passkey').click();
  await expect(page.getByTestId('passkey-row')).toHaveCount(1);
  // the row menu is visible on hover (desktop)
  await page.getByTestId('passkey-row').hover();
  await expect(page.getByTestId('passkey-row').getByTestId('row-menu')).toHaveCSS('opacity', '1');

  // «Lock» in the user menu (a factor exists, no lock setting needed)
  await page.reload();
  await page.getByTestId('sidebar').getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Заблокировать' }).click();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Разблокировать через PassKey' }).click();
  await expect(page.getByTestId('lock-screen')).toBeHidden();
  await page.goto('/profile?tab=security');

  // lock on every open: a reload asks for the passkey
  await pick(page.getByRole('combobox', { name: 'Блокировка приложения' }), 'При каждом открытии');
  await expect(page.getByTestId('lock-wipe')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  expect((await page.request.get('/api/v1/spaces')).status()).toBe(423);
  await page.getByTestId('factor-passkey').click();
  await expect(page.getByTestId('lock-screen')).toBeHidden();
  expect((await page.request.get('/api/v1/spaces')).status()).toBe(200);

  // passwordless sign-in with the discoverable key
  await signOut(page);
  await page.getByRole('button', { name: 'Войти через PassKey' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId('lock-screen')).toBeHidden();

  // TOTP: QR/secret → code → recovery codes; the password then asks for the second factor
  await page.goto('/profile?tab=security'); // a page load — the lock again
  await page.getByTestId('factor-passkey').click();
  await expect(page.getByTestId('lock-screen')).toBeHidden();
  await page.getByTestId('totp-start').click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Код').fill(totp(secret));
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);

  await signOut(page);
  await signIn(page, login);
  await expect(page.getByText('Подтвердите вход вторым фактором')).toBeVisible();
  await expect(page.getByTestId('factor-passkey')).toBeVisible();
  await page.getByTestId('factor-code').fill(totp(secret, Math.floor(Date.now() / 30_000) + 1));
  await page.getByRole('button', { name: 'Войти по коду' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await ctx.close();
});
