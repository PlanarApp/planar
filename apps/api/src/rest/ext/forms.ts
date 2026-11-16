import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { eq } from 'drizzle-orm';
import type { ExtArea, ExtOp } from './types.js';
import {
  boardRow,
  boardsOf,
  cols,
  firstStatus,
  formRow,
  genSlug,
  lastRank,
  visibleSpaceOf,
  widgetRow,
  widgetsOf,
  wireRow,
  wireRows,
} from './forms.service.js';

// PLNRAPP-276 (part 2): forms (the link without secrets), dashboards and widgets over the existing mutators; rights — of the mutators
const id = z.uuid();
const field = z.object({
  key: z
    .string()
    .describe('title | description | email | files | field:<uuid поля проекта>; title обязателен'),
  label: z.string().min(1).max(200),
  required: z.boolean(),
});
const fields = z.array(field).max(30);
const box = {
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
};
const config = z
  .record(z.string(), z.unknown())
  .describe(
    'Настройки по виду: filter {op:and|or, rules:[{field,operator,value}]}; bars — +groupBy (status|priority|assignee|label|project|field:<id>); line — +series (created|completed), weeks 4..52; list — +sort (updatedAt|dueDate|priority), limit 1..50',
  );
const kind = z.enum(['number', 'bars', 'line', 'list']);

const ops: ExtOp[] = [
  {
    tool: 'list_forms',
    description: 'Формы проекта (заявки в задачи): название, поля, статус новых задач, включена ли',
    method: 'get',
    path: '/api/v1/projects/{id}/forms',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const pid = (i as { id: string }).id;
      await d.visibleProject(u, pid);
      await d.moduleOn(u, 'forms', pid);
      const c = cols('formsForms');
      return wireRows(d, 'formsForms', eq(c.projectId!, pid), [c.createdAt!, c.id!]);
    },
  },
  {
    tool: 'get_form',
    description: 'Форма по id: поля, статус новых задач, slug, включена ли',
    method: 'get',
    path: '/api/v1/forms/{id}',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string };
      await formRow(d, u, a.id);
      return wireRow(d, 'formsForms', a.id);
    },
  },
  {
    tool: 'create_form',
    description:
      'Создать форму в проекте (нужны права администратора пространства). Поля по умолчанию — только обязательный title; статус новых задач по умолчанию — первый статус проекта',
    method: 'post',
    path: '/api/v1/projects/{id}/forms',
    shape: {
      id,
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      statusId: id.optional(),
      fields: fields.optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const {
        id: pid,
        fields: f,
        statusId,
        ...rest
      } = i as {
        id: string;
        fields?: unknown;
        statusId?: string;
      };
      await d.visibleProject(u, pid);
      await d.moduleOn(u, 'forms', pid);
      const fid = uuidv7();
      await d.run(
        u,
        [
          {
            name: 'forms.create',
            args: {
              id: fid,
              projectId: pid,
              slug: genSlug(),
              statusId: statusId ?? (await firstStatus(d, pid)),
              fields: f ?? [{ key: 'title', label: 'Заголовок', required: true }],
              ...rest,
            },
          },
        ],
        t,
      );
      return wireRow(d, 'formsForms', fid);
    },
  },
  {
    tool: 'update_form',
    description:
      'Изменить форму: название, описание, поля (заменяются целиком), статус новых задач, включена ли',
    method: 'patch',
    path: '/api/v1/forms/{id}',
    shape: {
      id,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      fields: fields.optional(),
      statusId: id.optional(),
      enabled: z.boolean().optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await formRow(d, u, a.id);
      await d.run(u, [{ name: 'forms.update', args: a }], t);
      return wireRow(d, 'formsForms', a.id);
    },
  },
  {
    tool: 'delete_form',
    description: 'Удалить форму (её публичная ссылка перестаёт работать)',
    method: 'delete',
    path: '/api/v1/forms/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await formRow(d, u, a.id);
      await d.run(u, [{ name: 'forms.delete', args: a }], t);
    },
  },
  {
    tool: 'get_form_link',
    description:
      'Публичная ссылка на форму (без секретов: токены личных ссылок не выдаются) и включена ли она',
    method: 'get',
    path: '/api/v1/forms/{id}/link',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const f = (await formRow(d, u, (i as { id: string }).id)) as {
        slug: string;
        enabled: boolean;
      };
      return {
        path: `/f/${f.slug}`,
        url: d.origin ? `${d.origin}/f/${f.slug}` : null,
        enabled: f.enabled,
      };
    },
  },
  {
    tool: 'list_dashboards',
    description: 'Дашборды пространства (общие и свои личные) с виджетами',
    method: 'get',
    path: '/api/v1/spaces/{id}/dashboards',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const sid = (i as { id: string }).id;
      await visibleSpaceOf(d, u, sid, 'Пространство');
      return boardsOf(d, u, sid);
    },
  },
  {
    tool: 'get_dashboard',
    description: 'Дашборд по id с виджетами',
    method: 'get',
    path: '/api/v1/dashboards/{id}',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string };
      await boardRow(d, u, a.id);
      return { ...(await wireRow(d, 'dashboardsBoards', a.id)), widgets: await widgetsOf(d, a.id) };
    },
  },
  {
    tool: 'create_dashboard',
    description: 'Создать дашборд в пространстве; personal=true — личный (виден только автору)',
    method: 'post',
    path: '/api/v1/spaces/{id}/dashboards',
    shape: { id, name: z.string().min(1).max(100), personal: z.boolean().optional() },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: sid, ...rest } = i as { id: string };
      await visibleSpaceOf(d, u, sid, 'Пространство');
      const bid = uuidv7();
      const rank = await lastRank(
        d,
        'dashboardsBoards',
        eq(cols('dashboardsBoards').spaceId!, sid),
      );
      await d.run(
        u,
        [{ name: 'dashboards.create', args: { id: bid, spaceId: sid, rank, ...rest } }],
        t,
      );
      return wireRow(d, 'dashboardsBoards', bid);
    },
  },
  {
    tool: 'update_dashboard',
    description: 'Переименовать дашборд',
    method: 'patch',
    path: '/api/v1/dashboards/{id}',
    shape: { id, name: z.string().min(1).max(100) },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await boardRow(d, u, a.id);
      await d.run(u, [{ name: 'dashboards.update', args: a }], t);
      return wireRow(d, 'dashboardsBoards', a.id);
    },
  },
  {
    tool: 'delete_dashboard',
    description: 'Удалить дашборд вместе с его виджетами',
    method: 'delete',
    path: '/api/v1/dashboards/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await boardRow(d, u, a.id);
      await d.run(u, [{ name: 'dashboards.delete', args: a }], t);
    },
  },
  {
    tool: 'create_widget',
    description:
      'Добавить виджет на дашборд: kind number|bars|line|list, config по виду, позиция в сетке на 12 колонок (x+w ≤ 12)',
    method: 'post',
    path: '/api/v1/dashboards/{id}/widgets',
    shape: { id, kind, config, ...box, title: z.string().max(100).nullable().optional() },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: bid, ...rest } = i as { id: string };
      await boardRow(d, u, bid);
      const wid = uuidv7();
      await d.run(
        u,
        [{ name: 'dashboards.widget.add', args: { id: wid, dashboardId: bid, ...rest } }],
        t,
      );
      return wireRow(d, 'dashboardsWidgets', wid);
    },
  },
  {
    tool: 'update_widget',
    description: 'Изменить виджет: заголовок, config (по его виду), позицию и размер',
    method: 'patch',
    path: '/api/v1/widgets/{id}',
    shape: {
      id,
      title: z.string().max(100).nullable().optional(),
      config: config.optional(),
      x: box.x.optional(),
      y: box.y.optional(),
      w: box.w.optional(),
      h: box.h.optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await widgetRow(d, u, a.id);
      await d.run(u, [{ name: 'dashboards.widget.update', args: a }], t);
      return wireRow(d, 'dashboardsWidgets', a.id);
    },
  },
  {
    tool: 'delete_widget',
    description: 'Удалить виджет с дашборда',
    method: 'delete',
    path: '/api/v1/widgets/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await widgetRow(d, u, a.id);
      await d.run(u, [{ name: 'dashboards.widget.remove', args: a }], t);
    },
  },
];

export const area: ExtArea = { name: 'forms', ops };
