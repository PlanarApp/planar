import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { emailPrefs } from '@planar/module-email/api/schema';
import type { ExtArea, ExtOp } from './types.js';
import { gitTask, makeBranch, sharedOn } from './mailgit.service.js';

// PLNRAPP-279 (part 2): own mail preferences and GitLab branch / MR of a task; no tokens, no SMTP/IMAP settings
const task = z.string().min(1).describe('uuid или ключ задачи, например ABC-123');
const conn = z
  .uuid()
  .optional()
  .describe('id подключённого репозитория (см. list_task_repos); по умолчанию первый');

const prefsOf = async (d: Parameters<ExtOp['run']>[0], userId: string) => {
  const [r] = await d.db.select().from(emailPrefs).where(eq(emailPrefs.id, userId));
  return { notify: r?.notify ?? true, digest: r?.digest ?? false };
};

const ops: ExtOp[] = [
  {
    tool: 'get_email_prefs',
    description:
      'Мои почтовые предпочтения: письма об уведомлениях (notify) и ежедневный дайджест (digest)',
    method: 'get',
    path: '/api/v1/me/email-prefs',
    shape: {},
    write: false,
    run: async (d, u) => {
      await sharedOn(d, 'email');
      return prefsOf(d, u);
    },
  },
  {
    tool: 'set_email_prefs',
    description:
      'Изменить мои почтовые предпочтения: письма об уведомлениях и/или ежедневный дайджест',
    method: 'put',
    path: '/api/v1/me/email-prefs',
    shape: { notify: z.boolean().optional(), digest: z.boolean().optional() },
    write: true,
    run: async (d, u, i, t) => {
      await sharedOn(d, 'email');
      await d.run(u, [{ name: 'email.setPrefs', args: { id: u, ...i } }], t);
      return prefsOf(d, u);
    },
  },
  {
    tool: 'list_task_repos',
    description: 'Репозитории GitLab, подключённые к проекту задачи (id и путь, без токенов)',
    method: 'get',
    path: '/api/v1/tasks/{task}/repos',
    shape: { task },
    write: false,
    run: async (d, u, i) => {
      const { conns } = await gitTask(d, u, (i as { task: string }).task, false);
      return conns.map((c) => ({ id: c.id, path: c.path }));
    },
  },
  {
    tool: 'create_task_branch',
    description:
      'Создать в GitLab ветку по задаче: имя — ключ задачи, от ветки по умолчанию; существующая не ошибка. Возвращает webUrl',
    method: 'post',
    path: '/api/v1/tasks/{task}/branch',
    shape: { task, connectionId: conn },
    write: true,
    status: 201,
    run: async (d, u, i) => {
      const a = i as { task: string; connectionId?: string };
      return makeBranch(d, u, a.task, a.connectionId, false);
    },
  },
  {
    tool: 'create_task_mr',
    description:
      'Создать в GitLab ветку по задаче (если её нет) и MR из неё в ветку по умолчанию; заголовок «КЛЮЧ: название». Возвращает webUrl; в задаче MR появится при ближайшем опросе',
    method: 'post',
    path: '/api/v1/tasks/{task}/mr',
    shape: { task, connectionId: conn },
    write: true,
    status: 201,
    run: async (d, u, i) => {
      const a = i as { task: string; connectionId?: string };
      return makeBranch(d, u, a.task, a.connectionId, true);
    },
  },
];

export const area: ExtArea = { name: 'mailgit', ops };
