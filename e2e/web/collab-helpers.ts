import { expect, request, type Page } from '@playwright/test';
import { BASE, Client, uuidv7 } from '../lib.js';
import type { Fixture } from './helpers.js';

export const MODULES = ['docs', 'chat'];

/** settings.enabled_modules от админа. */
export const setModules = (admin: Client, ids: string[]) =>
  admin.pushOk([admin.mut('settings.set', { id: 'enabled_modules', value: ids })]);

/** Третий пользователь (не alice/bob); создаётся при первом вызове, пароль = логин (≥ 8 символов). */
export async function carol(admin: Client, f: Fixture): Promise<Client> {
  const login = 'carol-e2e';
  const r = await admin.ctx.post('/api/users', {
    data: { login, name: 'Carol', password: login, role: 'member' },
  });
  if (!r.ok() && r.status() !== 409) throw new Error(`create carol: ${r.status()}`);
  const c = await Client.login(login);
  await admin.pushOk([
    admin.mut('member.add', { id: uuidv7(), spaceId: f.spaceId, userId: c.userId, role: 'member' }),
  ]);
  return c;
}

export const textDoc = (text: string, mention?: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        ...(mention
          ? [
              { type: 'mention', attrs: { id: mention } },
              { type: 'text', text: ' ' },
            ]
          : []),
        { type: 'text', text },
      ],
    },
  ],
});

export const sendMsg = (
  c: Client,
  channelId: string,
  text: string,
  extra: Record<string, unknown> = {},
) =>
  c.pushOk([
    c.mut('chat.message.send', {
      id: uuidv7(),
      channelId,
      body: textDoc(text),
      readId: uuidv7(),
      ...extra,
    }),
  ]);

/** Загрузка файла через POST /files; возвращает sha256. */
export async function upload(c: Client, name: string, data: string): Promise<string> {
  const r = await c.ctx.post('/files', {
    multipart: { file: { name, mimeType: 'text/plain', buffer: Buffer.from(data) } },
  });
  if (!r.ok()) throw new Error(`upload: ${r.status()}`);
  return (await r.json()).sha256;
}

export async function dm(c: Client, ...others: Client[]): Promise<string> {
  const id = uuidv7();
  await c.pushOk([
    c.mut('chat.dm.create', {
      id,
      members: [c, ...others].map((x) => ({ id: uuidv7(), userId: x.userId })),
    }),
  ]);
  return id;
}

export async function channel(admin: Client, f: Fixture, name: string): Promise<string> {
  const id = uuidv7();
  await admin.pushOk([admin.mut('chat.channel.create', { id, spaceId: f.spaceId, name })]);
  return id;
}

export const status = async (c: Client, path: string): Promise<number> =>
  (await c.ctx.get(path)).status();

export { BASE, request };

/** Открывает url модуля как SPA-переход: при холодной загрузке маршруты модулей ещё не добавлены (реплика грузится), и роутер разрешает url в заглушку. */
export async function spaGo(p: Page, url: string) {
  await p.goto('/');
  await expect(p.getByTestId('sidebar')).toBeVisible();
  await expect(p.getByTestId('group-tabs').getByRole('link', { name: 'Документы' })).toBeVisible();
  await p.evaluate((u) => {
    history.pushState({}, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}
