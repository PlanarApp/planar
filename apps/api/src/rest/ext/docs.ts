import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ExtArea, ExtDeps, ExtOp } from './types.js';
import { cols, lastRank, notFound, visibleSpaceOf, wireRow } from './planning.service.js';
import { commentDoc, commentOf, pageOf } from './docs.service.js';
import { findTask } from './tasks.service.js';

// PLNRAPP-277: page move/archive/lock, versions, comment edit/assign, unlink task — over the docs mutators; rights — of the mutators
const id = z.uuid();
const page = id.describe('id страницы документа');
const comment = id.describe('id комментария страницы');

/** page without body / text / files (as list_docs) */
const meta = async (d: ExtDeps, pid: string) => {
  const m = await wireRow(d, 'docsPages', pid);
  for (const k of ['body', 'text', 'files']) delete m[k];
  return m;
};
const ok = { ok: true };

const ops: ExtOp[] = [
  {
    tool: 'move_doc',
    description:
      'Переместить страницу документа: в конец под parentId (null — в корень) в том же или другом проекте/пространстве; вместе с подстраницами',
    method: 'post',
    path: '/api/v1/docs/{id}/move',
    shape: {
      id: page,
      parentId: id.nullable().describe('новый родитель; null — корень'),
      projectId: id
        .nullable()
        .optional()
        .describe('для корня: проект (null — страница пространства)'),
      spaceId: id.optional().describe('для корня: пространство'),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as {
        id: string;
        parentId: string | null;
        projectId?: string | null;
        spaceId?: string;
      };
      const p = await pageOf(d, u, a.id);
      const c = cols('docsPages');
      let where;
      if (a.parentId) {
        // the target parent must be visible too
        await pageOf(d, u, a.parentId);
        where = eq(c.parentId!, a.parentId);
      } else {
        const space = a.spaceId ?? (p.spaceId as string);
        const project = a.projectId === undefined ? (p.projectId as string | null) : a.projectId;
        await visibleSpaceOf(d, u, space, 'Пространство');
        if (project) {
          await d.visibleProject(u, project);
          await d.moduleOn(u, 'docs', project);
        }
        where = and(
          eq(c.spaceId!, space),
          isNull(c.parentId!),
          project ? eq(c.projectId!, project) : isNull(c.projectId!),
        )!;
      }
      const rank = await lastRank(d, 'docsPages', where);
      await d.run(
        u,
        [
          {
            name: 'docs.page.move',
            args: {
              id: a.id,
              parentId: a.parentId,
              rank,
              projectId: a.projectId,
              spaceId: a.spaceId,
            },
          },
        ],
        t,
      );
      return meta(d, a.id);
    },
  },
  {
    tool: 'archive_doc',
    description:
      'Отправить страницу документа в архив вместе с подстраницами (через 30 дней удаляется)',
    method: 'post',
    path: '/api/v1/docs/{id}/archive',
    shape: { id: page },
    write: true,
    run: async (d, u, i, t) => {
      const { id: pid } = i as { id: string };
      await pageOf(d, u, pid);
      await d.run(u, [{ name: 'docs.page.archive', args: { id: pid } }], t);
      return meta(d, pid);
    },
  },
  {
    tool: 'restore_doc',
    description:
      'Восстановить страницу документа из архива вместе с подстраницами (admin проекта/пространства)',
    method: 'post',
    path: '/api/v1/docs/{id}/restore',
    shape: { id: page },
    write: true,
    run: async (d, u, i, t) => {
      const { id: pid } = i as { id: string };
      await pageOf(d, u, pid);
      await d.run(u, [{ name: 'docs.page.restore', args: { id: pid } }], t);
      return meta(d, pid);
    },
  },
  {
    tool: 'delete_doc',
    description:
      'Удалить навсегда страницу документа из архива вместе с подстраницами, комментариями и версиями; не из архива — конфликт',
    method: 'delete',
    path: '/api/v1/docs/{id}',
    shape: { id: page },
    write: true,
    danger: 'delete',
    run: async (d, u, i, t) => {
      const { id: pid } = i as { id: string };
      await pageOf(d, u, pid);
      await d.run(u, [{ name: 'docs.page.delete', args: { id: pid } }], t);
      return ok;
    },
  },
  {
    tool: 'lock_doc',
    description:
      'Занять страницу документа для правки (блокировка на время; чужая активная — конфликт)',
    method: 'post',
    path: '/api/v1/docs/{id}/lock',
    shape: { id: page },
    write: true,
    run: async (d, u, i, t) => {
      const { id: pid } = i as { id: string };
      await pageOf(d, u, pid);
      await d.run(u, [{ name: 'docs.lock', args: { pageId: pid } }], t);
      return wireRow(d, 'docsLocks', pid);
    },
  },
  {
    tool: 'unlock_doc',
    description: 'Снять свою блокировку страницы документа',
    method: 'delete',
    path: '/api/v1/docs/{id}/lock',
    shape: { id: page },
    write: true,
    danger: 'delete',
    run: async (d, u, i, t) => {
      const { id: pid } = i as { id: string };
      await pageOf(d, u, pid);
      await d.run(u, [{ name: 'docs.unlock', args: { pageId: pid } }], t);
      return ok;
    },
  },
  {
    tool: 'list_doc_versions',
    description:
      'История версий страницы документа: {id, source, createdBy, createdAt, updatedAt}, новые первыми; без содержимого',
    method: 'get',
    path: '/api/v1/docs/{id}/versions',
    shape: { id: page },
    write: false,
    run: async (d, u, i) => {
      const { id: pid } = i as { id: string };
      await pageOf(d, u, pid);
      const r = await d.db.execute(sql`select v.id, v.source, v.created_by as "createdBy",
        to_json(v.created_at) as "createdAt", to_json(v.updated_at) as "updatedAt"
        from docs_versions v where v.page_id = ${pid} order by v.created_at desc`);
      return r.rows;
    },
  },
  {
    tool: 'restore_doc_version',
    description:
      'Восстановить версию страницы документа: её содержимое становится содержимым страницы (в истории появится новая версия)',
    method: 'post',
    path: '/api/v1/doc-versions/{id}/restore',
    shape: { id: id.describe('id версии из list_doc_versions') },
    write: true,
    run: async (d, u, i, t) => {
      const { id: vid } = i as { id: string };
      const r = await d.db.execute(
        sql`select page_id as "pageId", body from docs_versions where id = ${vid}`,
      );
      const v = r.rows[0] as { pageId: string; body: unknown } | undefined;
      if (!v) throw notFound('Версия');
      await pageOf(d, u, v.pageId);
      await d.run(u, [{ name: 'docs.page.update', args: { id: v.pageId, body: v.body } }], t);
      return meta(d, v.pageId);
    },
  },
  {
    tool: 'update_doc_comment',
    description: 'Изменить свой комментарий страницы документа (@login — упоминание)',
    method: 'patch',
    path: '/api/v1/doc-comments/{id}',
    shape: { id: comment, text: z.string().min(1).max(20000) },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; text: string };
      await commentOf(d, u, a.id);
      await d.run(
        u,
        [{ name: 'docs.comment.update', args: { id: a.id, body: await commentDoc(d, a.text) } }],
        t,
      );
      const r = await wireRow(d, 'docsComments', a.id);
      return {
        id: r.id,
        parentId: r.parentId,
        authorId: r.authorId,
        assigneeId: r.assigneeId,
        editedAt: r.editedAt,
      };
    },
  },
  {
    tool: 'delete_doc_comment',
    description: 'Удалить свой комментарий страницы документа вместе с ответами',
    method: 'delete',
    path: '/api/v1/doc-comments/{id}',
    shape: { id: comment },
    write: true,
    danger: 'delete',
    run: async (d, u, i, t) => {
      const { id: cid } = i as { id: string };
      await commentOf(d, u, cid);
      await d.run(u, [{ name: 'docs.comment.delete', args: { id: cid } }], t);
      return ok;
    },
  },
  {
    tool: 'assign_doc_comment',
    description:
      'Назначить комментарий страницы документа исполнителем (участник пространства, не гость); null — снять; назначение переоткрывает ветку',
    method: 'put',
    path: '/api/v1/doc-comments/{id}/assignee',
    shape: { id: comment, assigneeId: id.nullable() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; assigneeId: string | null };
      await commentOf(d, u, a.id);
      await d.run(u, [{ name: 'docs.comment.assign', args: a }], t);
      const r = await wireRow(d, 'docsComments', a.id);
      return { id: r.id, assigneeId: r.assigneeId, resolvedAt: r.resolvedAt };
    },
  },
  {
    tool: 'unlink_doc_task',
    description: 'Снять связь страницы документа с задачей',
    method: 'delete',
    path: '/api/v1/docs/{id}/tasks/{task}',
    shape: { id: page, task: z.string().min(1).describe('uuid или ключ задачи, например ABC-123') },
    write: true,
    danger: 'delete',
    run: async (d, u, i, t) => {
      const a = i as { id: string; task: string };
      await pageOf(d, u, a.id);
      const task = await findTask(d, u, a.task);
      await d.run(u, [{ name: 'docs.link.remove', args: { pageId: a.id, taskId: task.id } }], t);
      return ok;
    },
  },
];

export const area: ExtArea = { name: 'docs', ops };
