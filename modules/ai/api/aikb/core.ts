import { appUrl, type AppTarget } from '@planar/shared';

/** [label, target]: the templates of the core block; ids are placeholders (aikb-urls v1), URLs come from appUrl. */
export const URL_TARGETS: [string, AppTarget][] = [
  ['task', { kind: 'task', key: '<KEY>' }],
  ['task comment', { kind: 'comment', on: 'task', id: '<KEY>', commentId: '<commentId>' }],
  ['doc page', { kind: 'doc', pageId: '<pageId>' }],
  ['page comment', { kind: 'comment', on: 'page', id: '<pageId>', commentId: '<commentId>' }],
  ['my chat', { kind: 'chat' }],
  ['chat channel', { kind: 'chat', channelId: '<channelId>' }],
  ['task chat', { kind: 'taskChat', channelId: '<channelId>' }],
  ['doc chat', { kind: 'docChat', channelId: '<channelId>' }],
  ['project', { kind: 'project', projectId: '<projectId>' }],
  ['project view', { kind: 'project', projectId: '<projectId>', view: '<view>' }],
  ['space', { kind: 'space', spaceId: '<spaceId>' }],
  ['space tab', { kind: 'space', spaceId: '<spaceId>', tab: '<tab>' }],
  ['board', { kind: 'section', section: 'board', projectId: '<projectId>' }],
  ['list', { kind: 'section', section: 'list', projectId: '<projectId>' }],
  ['project docs', { kind: 'section', section: 'docs', projectId: '<projectId>' }],
  ['cycles', { kind: 'section', section: 'cycles', projectId: '<projectId>' }],
  ['project settings', { kind: 'section', section: 'settings', projectId: '<projectId>' }],
  ['workspace settings', { kind: 'section', section: 'settings' }],
  ['AI tasks', { kind: 'section', section: 'aiTasks' }],
];

/** The block every AI run gets (budget: 1500 tokens ~ 6000 chars). `ids` — the section ids of the details tool. */
export function core(publicUrl: string, ids: string[] = []): string {
  const base = publicUrl.replace(/\/+$/, '');
  return `You work inside a Planar instance at ${base}.

Entities: space > project > task. A task has a key like ABC-12 (project key + number), a status (category backlog, todo, in_progress, done, cancelled), assignees, labels, comments, subtasks. Documents are wiki pages in a space or project. Chats are channels (personal, task, document).

Links. When asked for a link, answer with a ready URL from these templates, never a bare id or key. Replace <placeholders> with real values:
${URL_TARGETS.map(([l, t]) => `- ${l}: ${appUrl(base, t)}`).join('\n')}

Details: call the MCP tool ai_kb without arguments to list the sections, or with section=<id> for the text.${ids.length ? ` Sections: ${ids.join(', ')}.` : ''}`;
}
