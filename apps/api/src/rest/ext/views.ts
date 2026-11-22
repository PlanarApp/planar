import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { toWire } from '../../sync/rows.js';
import type { ExtArea, ExtOp } from './types.js';
import {
  listDay,
  listFavorites,
  listNotifications,
  listViews,
  nextFavoriteRank,
  nextViewRank,
  ownFavorite,
  requireFavoriteRef,
  requireNode,
  requireOwnNotifications,
  requireSpace,
  viewRow,
  wireView,
} from './views.service.js';

// PLNRAPP-274: saved views, favourites, "My day", notifications — only the user's own, via existing mutators
const id = z.uuid();
const record = z.record(z.string(), z.unknown());
const rank = z.string().min(1);
const date = z.iso.date();
const node = z
  .string()
  .regex(/^(w|[sp]:[0-9a-f-]{36})(:me-(mine|assigned|created|watched))?$/)
  .describe('w | s:<id> | p:<id>');
const name = z.string().min(1).max(100);
const icon = z.string().max(32).nullable().optional();

const views: ExtOp[] = [
  {
    tool: 'list_views',
    description:
      'Сохранённые виды пространств пользователя: общие и личные (spaceId, node — фильтры)',
    method: 'get',
    path: '/api/v1/views',
    shape: { spaceId: id.optional(), node: z.string().optional() },
    write: false,
    run: (d, u, i) => {
      const a = i as { spaceId?: string; node?: string };
      return listViews(d, u, a.spaceId, a.node);
    },
  },
  {
    tool: 'create_view',
    description:
      'Создать сохранённый вид в пространстве (personal — личный; вид узла всегда личный; rank необязателен)',
    method: 'post',
    path: '/api/v1/views',
    shape: {
      spaceId: id,
      personal: z.boolean().default(true),
      name,
      icon,
      layout: z.string().min(1),
      node: node.nullable().optional(),
      filter: record.default({}),
      config: record.default({}),
      rank: rank.optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, tok) => {
      const a = i as { spaceId: string; node?: string | null; rank?: string };
      await requireSpace(d, u, a.spaceId);
      if (a.node) await requireNode(d, u, a.spaceId, a.node);
      const vid = uuidv7();
      await d.run(
        u,
        [
          {
            name: 'view.create',
            args: { ...a, id: vid, rank: a.rank ?? (await nextViewRank(d, a.spaceId)) },
          },
        ],
        tok,
      );
      return wireView(d, vid);
    },
  },
  {
    tool: 'update_view',
    description:
      'Изменить сохранённый вид: название, значок, раскладку, фильтр, конфигурацию, rank',
    method: 'patch',
    path: '/api/v1/views/{id}',
    shape: {
      id,
      name: name.optional(),
      icon,
      layout: z.string().min(1).optional(),
      filter: record.optional(),
      config: record.optional(),
      rank: rank.optional(),
    },
    write: true,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      await viewRow(d, u, a.id);
      await d.run(u, [{ name: 'view.update', args: a }], tok);
      return wireView(d, a.id);
    },
  },
  {
    tool: 'delete_view',
    description: 'Удалить сохранённый вид',
    method: 'delete',
    path: '/api/v1/views/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      await viewRow(d, u, a.id);
      await d.run(u, [{ name: 'view.delete', args: a }], tok);
    },
  },
  {
    tool: 'set_view_default',
    description:
      'Задать вид по умолчанию узла (пространство, проект) для раскладки: общий для участников, нужна роль member',
    method: 'post',
    path: '/api/v1/views/default',
    shape: {
      spaceId: id,
      node,
      layout: z.string().min(1),
      filter: record.default({}),
      config: record.default({}),
    },
    write: true,
    status: 201,
    run: async (d, u, i, tok) => {
      const a = i as { spaceId: string; node: string };
      await requireSpace(d, u, a.spaceId);
      await requireNode(d, u, a.spaceId, a.node);
      const vid = uuidv7();
      await d.run(u, [{ name: 'view.setNodeDefault', args: { ...a, id: vid } }], tok);
      return wireView(d, vid);
    },
  },
];

const favorites: ExtOp[] = [
  {
    tool: 'list_favorites',
    description: 'Избранное текущего пользователя по порядку',
    method: 'get',
    path: '/api/v1/favorites',
    shape: {},
    write: false,
    run: (d, u) => listFavorites(d, u),
  },
  {
    tool: 'add_favorite',
    description:
      'Добавить в избранное (kind: workspace/space/project/doc/chat/task, refId — id объекта, w для рабочего пространства); повтор возвращает существующую запись',
    method: 'post',
    path: '/api/v1/favorites',
    shape: {
      kind: z.enum(['workspace', 'space', 'project', 'doc', 'chat', 'task']),
      refId: z.string().min(1).max(100),
      name: z.string().max(500),
      url: z.string().min(1).max(2000),
      rank: rank.optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, tok) => {
      const a = i as { kind: string; refId: string; rank?: string };
      await requireFavoriteRef(d, u, a.kind, a.refId);
      await d.run(
        u,
        [
          {
            name: 'favorite.add',
            args: { ...a, id: uuidv7(), rank: a.rank ?? (await nextFavoriteRank(d, u)) },
          },
        ],
        tok,
      );
      const same = (await listFavorites(d, u)).find(
        (f) => f.kind === a.kind && f.refId === a.refId,
      );
      return same;
    },
  },
  {
    tool: 'move_favorite',
    description: 'Переставить избранное (новый rank)',
    method: 'patch',
    path: '/api/v1/favorites/{id}',
    shape: { id, rank },
    write: true,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      await ownFavorite(d, u, a.id);
      await d.run(u, [{ name: 'favorite.move', args: a }], tok);
      return toWire('favorites', await ownFavorite(d, u, a.id));
    },
  },
  {
    tool: 'remove_favorite',
    description: 'Убрать из избранного',
    method: 'delete',
    path: '/api/v1/favorites/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      await ownFavorite(d, u, a.id);
      await d.run(u, [{ name: 'favorite.remove', args: a }], tok);
    },
  },
];

// «My day» (PLNRAPP-709): the user's tasks (assignee) by dueDate; read only — the plan date is gone (PLNRAPP-711),
// a task is planned by its dueDate (update_task)
const day: ExtOp[] = [
  {
    tool: 'list_my_day',
    description:
      'Мой день: задачи, где текущий пользователь исполнитель, со сроком (dueDate — срок в этот день, иначе все со сроком); по сроку, приоритету и ключу. Запланировать, перенести или убрать задачу — срок (dueDate) в update_task',
    method: 'get',
    path: '/api/v1/my-day',
    shape: { dueDate: date.optional() },
    write: false,
    run: (d, u, i) => listDay(d, u, (i as { dueDate?: string }).dueDate),
  },
];

const notifications: ExtOp[] = [
  {
    tool: 'list_notifications',
    description: 'Уведомления текущего пользователя, новые сверху (unread — только непрочитанные)',
    method: 'get',
    path: '/api/v1/notifications',
    shape: {
      unread: z.stringbool().default(false),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    },
    write: false,
    run: (d, u, i) => {
      const a = i as { unread: boolean; limit: number };
      return listNotifications(d, u, a.unread, a.limit);
    },
  },
  {
    tool: 'mark_notifications_read',
    description: 'Отметить уведомления прочитанными по id',
    method: 'post',
    path: '/api/v1/notifications/read',
    shape: { ids: z.array(id).min(1).max(200) },
    write: true,
    run: async (d, u, i, tok) => {
      const a = i as { ids: string[] };
      await requireOwnNotifications(d, u, a.ids);
      await d.run(u, [{ name: 'notification.read', args: a }], tok);
      return { read: a.ids.length };
    },
  },
  {
    tool: 'mark_all_notifications_read',
    description: 'Отметить прочитанными все свои уведомления до момента upTo (по умолчанию сейчас)',
    method: 'post',
    path: '/api/v1/notifications/read-all',
    shape: { upTo: z.iso.datetime({ offset: true }).optional() },
    write: true,
    danger: 'bulk',
    run: async (d, u, i, tok) => {
      const upTo = new Date((i as { upTo?: string }).upTo ?? Date.now()).toISOString();
      await d.run(u, [{ name: 'notification.readAll', args: { upTo, except: [] } }], tok);
      return { upTo };
    },
  },
  {
    tool: 'delete_notification',
    description: 'Удалить своё уведомление',
    method: 'delete',
    path: '/api/v1/notifications/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, tok) => {
      const a = i as { id: string };
      await requireOwnNotifications(d, u, [a.id]);
      await d.run(u, [{ name: 'notification.delete', args: { ids: [a.id] } }], tok);
    },
  },
];

export const area: ExtArea = {
  name: 'views',
  ops: [...views, ...favorites, ...day, ...notifications],
};
