import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { pushPayloadSchema } from '@planar/shared';

const src = readFileSync('public/push-sw.js', 'utf8');
const origin = 'https://app.example';

const good = {
  title: 'Вас назначили',
  body: 'Починить вход',
  url: '/t/PLN-12',
  tag: '0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a90',
  kind: 'assigned',
};
const bad = { ...good, url: 'https://evil.example/t/1', tag: 'n1' };
const protoRel = { ...good, url: '//evil.example/x' };

type Handler = (e: unknown) => void;
function load() {
  const h: Record<string, Handler> = {};
  const showNotification = vi.fn(() => Promise.resolve());
  const openWindow = vi.fn(() => Promise.resolve());
  const warn = vi.fn();
  const self = {
    addEventListener: (t: string, f: Handler) => (h[t] = f),
    registration: { showNotification },
    clients: { matchAll: () => Promise.resolve([]), openWindow },
    location: { origin },
  };
  runInNewContext(src, { self, console: { warn }, URL });
  const push = (m: unknown) => h.push({ data: { json: () => m }, waitUntil: () => {} });
  const click = async (url: unknown) => {
    let p: Promise<unknown> = Promise.resolve();
    h.notificationclick({
      notification: { close: () => {}, data: { url } },
      waitUntil: (x: Promise<unknown>) => (p = x),
    });
    await p;
  };
  return { push, click, showNotification, openWindow, warn };
}

describe('inbox:push-format', () => {
  it('inbox:push-format корректное сообщение показывается с tag и data.url', () => {
    const t = load();
    t.push(good);
    expect(t.showNotification).toHaveBeenCalledWith(
      good.title,
      expect.objectContaining({ tag: good.tag, data: { url: good.url } }),
    );
  });

  it('inbox:push-format чужой url и //host не показываются', () => {
    const t = load();
    t.push(bad);
    t.push(protoRel);
    t.push({ ...good, kind: 'x' });
    t.push(null);
    expect(t.showNotification).not.toHaveBeenCalled();
    expect(t.warn).toHaveBeenCalledTimes(4);
  });

  it('inbox:push-format клик открывает путь своего origin, чужой — корень', async () => {
    const t = load();
    await t.click('/t/PLN-12');
    expect(t.openWindow).toHaveBeenLastCalledWith(origin + '/t/PLN-12');
    await t.click('https://evil.example/x');
    expect(t.openWindow).toHaveBeenLastCalledWith(origin + '/');
    await t.click('//evil.example/x');
    expect(t.openWindow).toHaveBeenLastCalledWith(origin + '/');
  });

  it('inbox:push-format правила SW совпадают с pushPayloadSchema', () => {
    const cases = [
      good,
      bad,
      protoRel,
      { ...good, title: '' },
      { ...good, tag: 'n1' },
      { ...good, body: 1 },
    ];
    for (const c of cases) {
      const t = load();
      t.push(c);
      const shown = t.showNotification.mock.calls.length === 1;
      // '//host' схема пропускает (startsWith('/')), SW — строже по требованию карточки
      expect(shown).toBe(pushPayloadSchema.safeParse(c).success && c !== protoRel);
    }
  });
});
