import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { PlanarDB } from '../../sync/db';
import { moduleIndexes, moduleMutators } from '../../sync';
import * as sdk from '../sdk';
import { setup, stopAll } from '../../sync/__tests__/helpers';
import * as time from '../../../../../modules/time/shared/index';
import * as sprints from '../../../../../modules/sprints/shared/index';

afterEach(stopAll);

describe('wk10:', () => {
  it('wk10: Dexie содержит таблицы сущностей модулей (sprintsCycles, timeEntries)', async () => {
    const db = new PlanarDB('wk10-' + uuidv7(), moduleIndexes([sprints.shared, time.shared]));
    await db.open();
    const names = db.tables.map((t) => t.name);
    expect(names).toContain('sprintsCycles');
    expect(names).toContain('sprintsSettings');
    expect(names).toContain('timeEntries');
    expect(names).toContain('tasks');
    await db.delete();
  });

  it('wk10: новая сущность модуля обновляет схему без потери таблиц и данных ядра', async () => {
    const name = 'wk10-up-' + uuidv7();
    const a = new PlanarDB(name, { modA: ['spaceId'] });
    const id = uuidv7();
    await a.table('tasks').put({ id, title: 'T' });
    const v1 = a.verno;
    a.close();
    const b = new PlanarDB(name, { modA: ['spaceId'], modB: ['x'] });
    await b.open();
    expect(b.verno).toBeGreaterThan(v1);
    expect(b.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['tasks', 'modA', 'modB']));
    expect(await b.table('tasks').get(id)).toMatchObject({ title: 'T' });
    // тот же набор — версия прежняя
    b.close();
    const c = new PlanarDB(name, { modA: ['spaceId'], modB: ['x'] });
    await c.open();
    expect(c.verno).toBe(b.verno);
    await c.delete();
  });

  it('wk10: база новее объявленной версии пересоздаётся, а не падает', async () => {
    const name = 'wk10-down-' + uuidv7();
    const a = new PlanarDB(name, { modA: [] });
    await a.open();
    a.close();
    localStorage.clear?.();
    // набор сменился, а подпись в хранилище потеряна → версия ниже установленной
    const hi = new PlanarDB(name, { modA: [], modB: [] });
    await hi.open();
    hi.close();
    localStorage.clear?.();
    const low = new PlanarDB(name, { modA: [] });
    await low.open();
    expect(low.isOpen()).toBe(true);
    expect(low.tables.map((t) => t.name)).not.toContain('modB');
    await low.delete();
  });

  it('wk10: мутатор модуля вызывается через mutate по имени', async () => {
    const s = setup();
    const db = new PlanarDB(s.dbName, moduleIndexes([sprints.shared]));
    const c = (await import('../../sync/client')).createClient(db);
    c.registerMutators(moduleMutators);
    await c.startSync({
      userId: uuidv7(),
      baseUrl: 'http://test',
      fetch: s.server.fetch as typeof fetch,
    });
    const projectId = uuidv7();
    await db.table('projects').put({ id: projectId, spaceId: uuidv7(), key: 'P' });
    await c.mutate('sprints.configure', { projectId, lengthDays: 7 });
    expect(await db.table('sprintsSettings').get(projectId)).toMatchObject({ lengthDays: 7 });
    await expect(c.mutate('nope.x', {})).rejects.toThrow();
    await c.stopSync();
  });

  it('wk10: SDK экспортирует состав контракта', () => {
    for (const k of [
      'defineWebModule',
      'db',
      'useQuery',
      'mutate',
      'useSession',
      'useTask',
      'useProjectTasks',
      'useStatuses',
      'useMembers',
      'useLabels',
      'openTask',
      'Button',
      'Input',
      'useI18n',
      'useWeekStart',
      'localToday',
      'matchFilter',
    ])
      expect(sdk, k).toHaveProperty(k);
  });
});

describe('wk14:', () => {
  it('wk14: SDK экспортирует Editor, uploadFile, api, ApiError, onMutationError, useSearch', () => {
    for (const k of ['Editor', 'uploadFile', 'api', 'ApiError', 'onMutationError', 'useSearch'])
      expect(sdk, k).toHaveProperty(k);
  });
});
