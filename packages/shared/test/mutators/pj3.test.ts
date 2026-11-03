// PJ-3: data modules per project (C-schema v16, C-mutators v12)
import { describe, expect, it } from 'vitest';
import { DATA_MODULE_IDS, isDataModule } from '../../src/index';
import { code, id, mem, run, seedSpace } from './helpers';

describe('PJ-3: project.setModule', () => {
  it('PJ-3 новый проект — без модулей; setModule включает, повтор идемпотентен, выключение сохраняет остальные', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    expect((await tx.get('projects', s.projectId))!.modules).toEqual([]);
    const set = (moduleId: string, enabled: boolean) =>
      run(tx, 'project.setModule', { projectId: s.projectId, moduleId, enabled });
    await set('time', true);
    await set('time', true);
    await set('docs', true);
    expect((await tx.get('projects', s.projectId))!.modules).toEqual(['time', 'docs']);
    await set('time', false);
    await set('time', false);
    expect((await tx.get('projects', s.projectId))!.modules).toEqual(['docs']);
  });

  it('PJ-3 общий или неизвестный модуль, несуществующий проект', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    for (const moduleId of ['chat', 'email', 'plugins', 'import', 'webhooks', 'hello', 'nope'])
      expect(
        await code(
          run(tx, 'project.setModule', { projectId: s.projectId, moduleId, enabled: true }),
        ),
      ).toBe('invalid_args');
    expect(
      await code(
        run(tx, 'project.setModule', { projectId: id(), moduleId: 'time', enabled: true }),
      ),
    ).toBe('not_found');
  });

  it('PJ-3 settings.set enabled_modules: id модуля данных → invalid_args, общие — ok', async () => {
    const tx = mem();
    const set = (value: unknown) => run(tx, 'settings.set', { id: 'enabled_modules', value });
    expect(await code(set(['chat', 'time']))).toBe('invalid_args');
    expect(await code(set(['docs']))).toBe('invalid_args');
    expect(await code(set(['chat', 'email']))).toBe('ok');
  });

  it('PJ-3 DATA_MODULE_IDS: 12 модулей данных, общие не входят', () => {
    expect(DATA_MODULE_IDS).toHaveLength(12);
    expect(isDataModule('gitlab')).toBe(true);
    for (const shared of ['chat', 'email', 'plugins', 'import', 'webhooks', 'hello'])
      expect(isDataModule(shared)).toBe(false);
  });
});
