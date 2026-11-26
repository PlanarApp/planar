import type { AppTarget } from './urls.js';

/** Примеры всех шаблонов: [цель, путь] — для тестов формата и соответствия роутеру. */
export const cases: [AppTarget, string][] = [
  [{ kind: 'task', key: 'PL-12' }, '/t/PL-12'],
  [{ kind: 'doc', pageId: 'p1' }, '/m/docs/p1'],
  [{ kind: 'chat' }, '/m/chat/'],
  [{ kind: 'chat', channelId: 'c1' }, '/m/chat/c/c1'],
  [{ kind: 'taskChat', channelId: 'c2' }, '/m/chat/c/c2'],
  [{ kind: 'docChat', channelId: 'c3' }, '/m/chat/c/c3'],
  [{ kind: 'project', projectId: 'pr' }, '/p/pr'],
  [{ kind: 'project', projectId: 'pr', view: 'board' }, '/p/pr/board'],
  [{ kind: 'space', spaceId: 's1', tab: 'docs' }, '/s/s1/docs'],
  [{ kind: 'section', section: 'board', projectId: 'pr' }, '/p/pr/board'],
  [{ kind: 'section', section: 'list', projectId: 'pr' }, '/p/pr/list'],
  [{ kind: 'section', section: 'docs', projectId: 'pr' }, '/p/pr/docs'],
  [{ kind: 'section', section: 'cycles', projectId: 'pr' }, '/p/pr/reports?r=sprints:sprint'],
  [{ kind: 'section', section: 'settings' }, '/w/settings'],
  [{ kind: 'section', section: 'settings', projectId: 'pr' }, '/p/pr/settings'],
  [{ kind: 'section', section: 'aiTasks' }, '/w/settings?s=ai:workspace&tab=tasks'],
  [{ kind: 'comment', on: 'task', id: 'PL-1', commentId: 'k' }, '/t/PL-1?comment=k'],
  [{ kind: 'comment', on: 'page', id: 'p1', commentId: 'k' }, '/m/docs/p1?comment=k'],
];
