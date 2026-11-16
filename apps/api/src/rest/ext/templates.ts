import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { HttpError } from '../../auth/errors.js';
import { lastProjectRank, projectRow } from './spaces.service.js';
import { cols, visibleSpaceOf, wireRows } from './planning.service.js';
import {
  freshIds,
  statusFor,
  taskRank,
  templateOf,
  templateWire,
  today,
} from './templates.service.js';
import { findTask } from './tasks.service.js';
import type { ExtArea, ExtOp } from './types.js';

// PLNRAPP-276 (templates): task and project templates, task / project from a template; rights — of the mutators
const id = z.uuid();
const kind = z.enum(['task', 'project']);
const data = z
  .record(z.string(), z.unknown())
  .describe(
    'Содержимое по виду: task — {title, description, priority 0-4, dueInDays, startInDays, fields, labels, assigneeIds, checklist, subtasks}; project — {project, statuses, labels, fields, tasks}; формат проверяет сервер',
  );
const name = z.string().min(1).max(200);
const description = z.string().max(2000).nullable().optional();

const ops: ExtOp[] = [
  {
    tool: 'list_templates',
    description: 'Шаблоны пространства (задач и проектов) с содержимым; kind — только один вид',
    method: 'get',
    path: '/api/v1/spaces/{id}/templates',
    shape: { id, kind: kind.optional() },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string; kind?: 'task' | 'project' };
      await visibleSpaceOf(d, u, a.id, 'Пространство');
      const c = cols('templatesTemplates');
      return wireRows(
        d,
        'templatesTemplates',
        and(eq(c.spaceId!, a.id), a.kind ? eq(c.kind!, a.kind) : undefined)!,
        [c.name!, c.id!],
      );
    },
  },
  {
    tool: 'get_template',
    description: 'Шаблон по id с содержимым',
    method: 'get',
    path: '/api/v1/templates/{id}',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const { id: tid } = i as { id: string };
      await templateOf(d, u, tid);
      return templateWire(d, tid);
    },
  },
  {
    tool: 'create_template',
    description:
      'Создать шаблон в пространстве: вид (task — задача с подзадачами, project — проект со статусами, метками, полями и задачами), название, описание, содержимое',
    method: 'post',
    path: '/api/v1/spaces/{id}/templates',
    shape: { id, kind, name, description, data },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: sid, ...rest } = i as { id: string };
      await visibleSpaceOf(d, u, sid, 'Пространство');
      const tid = uuidv7();
      await d.run(u, [{ name: 'templates.create', args: { id: tid, spaceId: sid, ...rest } }], t);
      return templateWire(d, tid);
    },
  },
  {
    tool: 'update_template',
    description: 'Изменить шаблон: название, описание, содержимое (вид не меняется)',
    method: 'patch',
    path: '/api/v1/templates/{id}',
    shape: { id, name: name.optional(), description, data: data.optional() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await templateOf(d, u, a.id);
      await d.run(u, [{ name: 'templates.update', args: a }], t);
      return templateWire(d, a.id);
    },
  },
  {
    tool: 'delete_template',
    description: 'Удалить шаблон (созданные из него задачи и проекты остаются)',
    method: 'delete',
    path: '/api/v1/templates/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await templateOf(d, u, a.id);
      await d.run(u, [{ name: 'templates.delete', args: a }], t);
    },
  },
  {
    tool: 'create_task_from_template',
    description:
      'Создать задачу из шаблона задачи в проекте того же пространства: статус (по умолчанию первый «К работе»), родительская задача; даты считаются от сегодняшнего дня (UTC). Отвечает {id} новой задачи',
    method: 'post',
    path: '/api/v1/templates/{id}/task',
    shape: {
      id,
      projectId: id,
      statusId: id.optional(),
      parent: z.string().min(1).optional().describe('uuid или ключ родительской задачи'),
    },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const a = i as { id: string; projectId: string; statusId?: string; parent?: string };
      const tpl = await templateOf(d, u, a.id, 'task');
      await d.visibleProject(u, a.projectId);
      await d.moduleOn(u, 'templates', a.projectId);
      const parent = a.parent ? await findTask(d, u, a.parent) : undefined;
      if (parent && parent.projectId !== a.projectId)
        throw new HttpError(400, 'invalid_request', 'Родительская задача из другого проекта');
      const statusId = await statusFor(d, a.projectId, a.statusId);
      const ids = freshIds('task', tpl.data);
      await d.run(
        u,
        [
          {
            name: 'templates.createTask',
            args: {
              templateId: a.id,
              projectId: a.projectId,
              statusId,
              rank: await taskRank(d, a.projectId, statusId),
              today: today(),
              ids,
              parentId: parent?.id ?? null,
            },
          },
        ],
        t,
      );
      return { id: ids[0] };
    },
  },
  {
    tool: 'create_project_from_template',
    description:
      'Создать проект из шаблона проекта в его пространстве: название и ключ (A–Z0-9, 2–10); статусы, метки, поля и задачи — из шаблона',
    method: 'post',
    path: '/api/v1/templates/{id}/project',
    shape: { id, name: z.string().min(1).max(100), key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/) },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const a = i as { id: string; name: string; key: string };
      const tpl = await templateOf(d, u, a.id, 'project');
      const pid = uuidv7();
      await d.run(
        u,
        [
          {
            name: 'templates.createProject',
            args: {
              templateId: a.id,
              projectId: pid,
              name: a.name,
              key: a.key,
              rank: await lastProjectRank(d, tpl.spaceId as string),
              today: today(),
              ids: freshIds('project', tpl.data),
            },
          },
        ],
        t,
      );
      return projectRow(d, pid);
    },
  },
];

export const area: ExtArea = { name: 'templates', ops };
