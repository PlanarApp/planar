// PLNRAPP-892: the module's contact with the web core — the task's PRs and commits from the replica, the language
import { db, i18n, useQuery } from '@planar/web/modules';
import type { GithubCommit, GithubPr } from '../shared/index.js';

export const prsOf = (taskId: string) =>
  db.table('githubPrs').where('taskId').equals(taskId).toArray() as Promise<GithubPr[]>;
export const commitsOf = (taskId: string) =>
  db.table('githubCommits').where('taskId').equals(taskId).toArray() as Promise<GithubCommit[]>;
export const usePrs = (taskId: () => string) => useQuery(() => prsOf(taskId()));
export const useCommits = (taskId: () => string) => useQuery(() => commitsOf(taskId()));

const dict = {
  prs: { ru: 'Pull requests', en: 'Pull requests' },
  commits: { ru: 'Коммиты', en: 'Commits' },
  open: { ru: 'открыт', en: 'open' },
  draft: { ru: 'черновик', en: 'draft' },
  merged: { ru: 'влит', en: 'merged' },
  closed: { ru: 'закрыт', en: 'closed' },
  refresh: { ru: 'Синхронизировать с GitHub', en: 'Sync with GitHub' },
  error: { ru: 'Ошибка', en: 'Error' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
