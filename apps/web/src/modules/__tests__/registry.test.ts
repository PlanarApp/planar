import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerModules, setEnabledModules, setModuleLoaders, useExtensions } from '../registry';

const cmd = (id: string) => ({ id, label: 'x', run: () => {} });

describe('settings:modules registry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setModuleLoaders({});
  });

  it('выключенный модуль не попадает в useExtensions, повторная регистрация не дублирует', async () => {
    registerModules([{ id: 'mod-a', commands: [cmd('c')] }]);
    registerModules([{ id: 'mod-a', commands: [cmd('c')] }]);
    registerModules([{ id: 'mod-b', commands: [cmd('c')] }]);
    const cmds = useExtensions('commands');
    await setEnabledModules(['mod-a']);
    expect(cmds.value.map((c) => c.key)).toEqual(['mod-a:c']);
    await setEnabledModules(['mod-a', 'mod-b']);
    expect(cmds.value.map((c) => c.key)).toEqual(['mod-a:c', 'mod-b:c']);
  });

  it('загрузчик берёт экспорт web, ошибка загрузки — warn без reject', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setModuleLoaders({
      '../../../../modules/mod-c/web/index.ts': async () => ({
        web: { id: 'mod-c', commands: [cmd('c')] },
      }),
      '../../../../modules/mod-d/web/index.ts': () => Promise.reject(new Error('boom')),
    });
    await setEnabledModules(['mod-a', 'mod-c', 'mod-d']);
    expect(useExtensions('commands').value.map((c) => c.key)).toContain('mod-c:c');
    expect(warn).toHaveBeenCalled();
  });
});
