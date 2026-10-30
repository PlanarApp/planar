import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ensureModule, moduleStatus, setEnabledModules, setModuleLoaders } from '../registry';

// one file — one registry instance: test order matters (enabled first = null)
describe('холодная реплика: ensureModule', () => {
  it('ждёт настройки и возвращает true после их появления', async () => {
    setModuleLoaders({
      '../../../../modules/cold/web/index.ts': async () => ({ web: { id: 'cold' } }),
    });
    expect(moduleStatus('cold')).toBe('loading');
    let done: boolean | undefined;
    const p = ensureModule('cold').then((r) => (done = r));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBeUndefined();
    await setEnabledModules(['cold']);
    expect(await p).toBe(true);
    expect(moduleStatus('cold')).toBe('ready');
  });

  it('выключенный → false только после загрузки настроек', async () => {
    await setEnabledModules(['cold']);
    expect(await ensureModule('off')).toBe(false);
    expect(moduleStatus('off')).toBe('off');
  });

  it('включён, но фронта нет или загрузка упала → error, не вечный скелетон', async () => {
    setModuleLoaders({
      '../../../../modules/boom/web/index.ts': async () => {
        throw new Error('x');
      },
    });
    await setEnabledModules(['cold', 'boom', 'ghost']);
    expect(await ensureModule('ghost')).toBe(false);
    expect(moduleStatus('ghost')).toBe('error');
    expect(moduleStatus('boom')).toBe('error');
  });
});
