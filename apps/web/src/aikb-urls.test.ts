import { beforeAll, describe, expect, it } from 'vitest';
import { appPath } from '@planar/shared';
import { web as ai } from '../../../modules/ai/web/index';
import { web as chat } from '../../../modules/chat/web/index';
import { web as docs } from '../../../modules/docs/web/index';
import { web as sprints } from '../../../modules/sprints/web/index';
import { registerModules } from './modules/registry';
import { router } from './router';
import { cases } from '../../../packages/shared/src/aikb/samples';

beforeAll(() => registerModules([ai, chat, docs, sprints]));

// именованный маршрут роутера или маршрут модуля (не catch-all `module`, не redirect)
const resolve = (path: string) => {
  const r = router.resolve(path);
  const rec = r.matched.at(-1)!;
  expect(rec.redirect, path).toBeUndefined();
  return { name: String(r.name ?? ''), rec, r };
};
const NAMED: Record<string, string> = {
  '/t': 'task',
  '/p': 'project',
  '/s': 'space',
  '/w': 'workspace',
};

describe('aikb-urls: шаблоны соответствуют роутеру', () => {
  it.each(cases)('%j', (t) => {
    const path = appPath(t);
    const { name, rec, r } = resolve(path);
    expect(name, path).not.toBe('module');
    if (path.startsWith('/m/')) {
      expect(name).toBe(''); // маршрут, добавленный модулем
      expect(rec.path.startsWith(`/m/${path.split('/')[2]}/`)).toBe(true);
    } else {
      expect(name).toBe(NAMED[path.slice(0, 2)]);
    }
    // параметры подставились, а не ушли в хвост
    if (name === 'task') expect(r.params.key).toBeTruthy();
    if (name === 'project') expect(r.params.projectId).toBe('pr');
  });

  it('вкладки и разделы, на которые указывают шаблоны, зарегистрированы', () => {
    expect(sprints.groupTabs?.some((g) => g.id === 'sprint' && g.tab === 'reports')).toBe(true);
    expect(docs.groupTabs?.some((g) => g.tab === 'docs')).toBe(true);
    expect(ai.settings?.some((s) => s.id === 'tasks' && s.level === 'workspace')).toBe(true);
  });
});
