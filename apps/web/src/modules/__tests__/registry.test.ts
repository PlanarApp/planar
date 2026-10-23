import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { registerModules, setEnabledModules, useExtensions } from '../registry';

const cmd = (id: string) => ({ id, label: 'x', run: () => {} });

describe('settings:modules registry', () => {
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
});
