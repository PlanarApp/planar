// PJ-3: modules per project — project settings section «Модули», enabledForProject, extensions of the project
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { useAuth, type User } from '../../../auth/useAuth';
import * as http from '../../../api/http';
import { db, ids, setup, show, wait } from './setup';
import ModulesSettings from '../ModulesSettings.vue';
import {
  enabledForProject,
  initModules,
  registerModules,
  setEnabledModules,
  useExtensions,
} from '../../../modules/registry';

setup();

const serve = () =>
  vi.spyOn(http, 'api').mockResolvedValue({
    modules: [
      { id: 'time', enabled: true },
      { id: 'docs', enabled: true },
      { id: 'chat', enabled: true },
      { id: 'email', enabled: false },
    ],
  });

describe('PJ-3: настройки проекта — модули', () => {
  it('PJ-3 в проекте — только модули данных; галочка пишет project.setModule и убирается обратно', async () => {
    serve();
    const w = await show(ModulesSettings, { projectId: ids.project });
    const rows = w.findAll('[data-testid=module-row]');
    expect(rows.map((r) => r.attributes('data-module'))).toEqual(['time', 'docs']);
    const time = w.find('[data-module=time] input');
    expect((time.element as HTMLInputElement).checked).toBe(false);
    await time.setValue(true);
    await wait();
    expect((await db.table('projects').get(ids.project)).modules).toEqual(['time']);
    await w.find('[data-module=time] input').setValue(false);
    await wait();
    expect((await db.table('projects').get(ids.project)).modules).toEqual([]);
  });

  it('PJ-3 без проекта — только общие модули экземпляра', async () => {
    serve();
    useAuth().user.value = { id: ids.ann, role: 'admin' } as User;
    const w = await show(ModulesSettings, {});
    expect(w.findAll('[data-testid=module-row]').map((r) => r.attributes('data-module'))).toEqual([
      'chat',
      'email',
    ]);
  });

  it('PJ-3 менять может админ пространства проекта или админ экземпляра; участник — переключатели заблокированы', async () => {
    serve();
    // ann is the admin of the space (setup)
    let w = await show(ModulesSettings, { projectId: ids.project });
    expect(w.findAll('input').every((i) => !(i.element as HTMLInputElement).disabled)).toBe(true);
    await db.table('spaceMembers').where('userId').equals(ids.ann).modify({ role: 'member' });
    w = await show(ModulesSettings, { projectId: ids.project });
    expect(w.findAll('input').every((i) => (i.element as HTMLInputElement).disabled)).toBe(true);
    useAuth().user.value = { id: ids.ann, role: 'owner' } as User;
    w = await show(ModulesSettings, { projectId: ids.project });
    expect(w.findAll('input').every((i) => !(i.element as HTMLInputElement).disabled)).toBe(true);
  });
});

describe('PJ-3: enabledForProject и расширения', () => {
  const cmd = (id: string) => ({ id, label: 'x', run: () => {} });

  it('PJ-3 элементы модуля данных видны только в проектах, где он включён; общий модуль — везде', async () => {
    registerModules([
      { id: 'time', taskPanels: [], commands: [cmd('a')] },
      { id: 'chat', commands: [cmd('b')] },
    ]);
    const pA = '0192b0a0-0000-7000-8000-00000000000a';
    const pB = '0192b0a0-0000-7000-8000-00000000000b';
    await db.table('projects').clear();
    for (const [id, modules] of [
      [pA, ['time']],
      [pB, []],
    ] as const)
      await db
        .table('projects')
        .put({ id, spaceId: ids.space, name: id, key: id.slice(-1), modules });
    initModules();
    await vi.waitFor(() => expect(enabledForProject('time', pB)).toBe(false)); // projects read from the replica
    await setEnabledModules(['chat', 'time']);
    expect(enabledForProject('time', pA)).toBe(true);
    expect(enabledForProject('time', pB)).toBe(false);
    expect(enabledForProject('time')).toBe(true); // summaries: on in at least one project
    expect(enabledForProject('time', [pB])).toBe(false);
    expect(enabledForProject('time', [pA, pB])).toBe(true);
    expect(enabledForProject('chat', pB)).toBe(true);
    const keys = (p?: string) => useExtensions('commands', p).value.map((c) => c.key);
    expect(keys(pA)).toEqual(expect.arrayContaining(['time:a', 'chat:b']));
    expect(keys(pB)).toContain('chat:b');
    expect(keys(pB)).not.toContain('time:a');
  });
});
