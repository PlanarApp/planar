// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { NOW, setup, stopAll } from './helpers';

const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
  const t = Date.now();
  while (!(await f())) {
    if (Date.now() - t > ms) throw new Error('until: таймаут');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const task = (title: string, text: string | null, updatedAt = NOW) => ({
  id: uuidv7(),
  title,
  description: text === null ? null : doc(text),
  updatedAt,
});
const descs = async (s: ReturnType<typeof setup>) =>
  Object.fromEntries(
    (await s.db.table('tasks').toArray()).map((t) => [
      t.title,
      t.description?.content[0].content[0].text ?? null,
    ]),
  );
const heavyFlag = async (s: ReturnType<typeof setup>) => (await s.db._meta.get('heavy'))?.value;

afterEach(stopAll);

describe('lean bootstrap: описания второй фазой', () => {
  it('ядро без описаний → страницы догружают их; после done фаза не запускается', async () => {
    const s = setup();
    s.server.seed('tasks', [task('a', 'A'), task('b', 'B'), task('c', 'C'), task('d', null)]);
    const c = s.mk();
    await s.start(c);
    await until(async () => (await heavyFlag(s)) === 'done');
    expect(await descs(s)).toEqual({ a: 'A', b: 'B', c: 'C', d: null });
    expect(s.server.heavyRequests).toBe(2); // 3 descriptions, 2 per page
    await c.syncNow();
    expect(s.server.heavyRequests).toBe(2);
  });

  it('гонка: правка, пришедшая pull-ом раньше страницы, не затирается устаревшим описанием', async () => {
    const s = setup();
    const t = task('a', 'старое');
    s.server.seed('tasks', [t]);
    s.server.beforeHeavy = async () => {
      // pull has already brought a newer version of the row; the page below is from an older snapshot
      await s.db
        .table('tasks')
        .put({ ...t, description: doc('новое'), updatedAt: '2026-10-22T11:00:00.000Z' });
    };
    const c = s.mk();
    await s.start(c);
    await until(async () => (await heavyFlag(s)) === 'done');
    expect(await descs(s)).toEqual({ a: 'новое' });
  });

  it('сбой второй фазы → флаг pending; после перезапуска докачивается', async () => {
    const s = setup();
    s.server.seed('tasks', [task('a', 'A'), task('b', 'B'), task('c', 'C')]);
    s.server.heavyFail = true;
    const c = s.mk();
    await s.start(c);
    await until(() => s.server.heavyRequests > 0);
    await c.stopSync();
    expect(await heavyFlag(s)).toBe('pending');
    expect(await descs(s)).toEqual({ a: null, b: null, c: null });
    s.server.heavyFail = false;
    await s.start(s.mk());
    await until(async () => (await heavyFlag(s)) === 'done');
    expect(await descs(s)).toEqual({ a: 'A', b: 'B', c: 'C' });
  });
});
