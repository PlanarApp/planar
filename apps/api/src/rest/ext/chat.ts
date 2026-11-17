import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm';
import { HttpError } from '../../auth/errors.js';
import type { ExtArea, ExtDeps, ExtOp } from './types.js';
import { cols, notFound, visibleSpaceOf, wireRow, wireRows } from './planning.service.js';
import { channelOf, docOf, messageOf, reactionsOf, visibleChannels } from './chat.service.js';

// PLNRAPP-278: chat channels, dialogs and messages over the module's mutators; a hidden channel/message is 404
const id = z.uuid();
const text = z.string().min(1).max(20000).describe('Текст; перевод строки — новый абзац');
const bool = z.union([z.boolean(), z.stringbool()]);

/** a dialog the user sees, else 404 */
async function dmOf(d: ExtDeps, u: string, cid: string) {
  const c = await channelOf(d, u, cid);
  if (c.kind !== 'dm') throw new HttpError(400, 'invalid_request', 'это не личный чат');
  return c;
}

async function membersOf(d: ExtDeps, c: Record<string, unknown>) {
  if (c.spaceId) {
    const m = cols('spaceMembers');
    const rows = await wireRows(d, 'spaceMembers', eq(m.spaceId!, c.spaceId as string), [
      m.createdAt!,
    ]);
    return rows.map((r) => ({ userId: r.userId, role: r.role }));
  }
  const m = cols('chatMembers');
  const rows = await wireRows(d, 'chatMembers', eq(m.channelId!, c.id as string), [m.createdAt!]);
  return rows.map((r) => ({ userId: r.userId }));
}

const ops: ExtOp[] = [
  {
    tool: 'list_chat_channels',
    description:
      'Каналы и личные чаты, доступные пользователю (недавние сверху); spaceId — только каналы пространства; archived=true — и архивные. С отметкой mute и последним прочитанным',
    method: 'get',
    path: '/api/v1/chat/channels',
    shape: { spaceId: id.optional(), archived: bool.optional() },
    write: false,
    run: async (d, u, i) => {
      const a = i as { spaceId?: string; archived?: boolean };
      const c = cols('chatChannels');
      const list = await visibleChannels(
        d,
        u,
        and(
          a.spaceId ? eq(c.spaceId!, a.spaceId) : undefined,
          a.archived ? undefined : isNull(c.archivedAt!),
        ),
      );
      const rc = cols('chatReads');
      const reads = await wireRows(d, 'chatReads', eq(rc.userId!, u), [rc.updatedAt!]);
      return list.map((ch) => {
        const r = reads.find((x) => x.channelId === ch.id);
        return { ...ch, muted: !!r?.muted, lastReadSeq: (r?.lastReadSeq as number) ?? 0 };
      });
    },
  },
  {
    tool: 'create_chat_channel',
    description: 'Создать канал в пространстве (нужна роль member); projectId — канал проекта',
    method: 'post',
    path: '/api/v1/spaces/{id}/chat/channels',
    shape: {
      id,
      name: z.string().min(1).max(80),
      topic: z.string().max(250).nullable().optional(),
      projectId: id.nullable().optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: spaceId, ...rest } = i as { id: string; projectId?: string | null };
      await visibleSpaceOf(d, u, spaceId, 'Пространство');
      if (rest.projectId) await d.visibleProject(u, rest.projectId);
      const cid = uuidv7();
      await d.run(u, [{ name: 'chat.channel.create', args: { id: cid, spaceId, ...rest } }], t);
      return wireRow(d, 'chatChannels', cid);
    },
  },
  {
    tool: 'create_chat_dm',
    description:
      'Создать личный чат с пользователями (userIds — другие участники, вы добавляетесь сами; всего до 8)',
    method: 'post',
    path: '/api/v1/chat/dms',
    shape: { userIds: z.array(id).min(1).max(7) },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { userIds } = i as { userIds: string[] };
      const cid = uuidv7();
      const members = [u, ...userIds.filter((x) => x !== u)].map((userId) => ({
        id: uuidv7(),
        userId,
      }));
      await d.run(u, [{ name: 'chat.dm.create', args: { id: cid, members } }], t);
      return wireRow(d, 'chatChannels', cid);
    },
  },
  {
    tool: 'list_chat_members',
    description: 'Участники канала (участники пространства) или личного чата',
    method: 'get',
    path: '/api/v1/chat/channels/{id}/members',
    shape: { id },
    write: false,
    run: async (d, u, i) => membersOf(d, await channelOf(d, u, (i as { id: string }).id)),
  },
  {
    tool: 'add_chat_member',
    description: 'Добавить участника в личный чат (до 8 участников)',
    method: 'post',
    path: '/api/v1/chat/dms/{id}/members',
    shape: { id, userId: id },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string };
      const c = await dmOf(d, u, a.id);
      await d.run(
        u,
        [{ name: 'chat.dm.addMember', args: { id: uuidv7(), channelId: a.id, userId: a.userId } }],
        t,
      );
      return membersOf(d, c);
    },
  },
  {
    tool: 'remove_chat_member',
    description: 'Убрать участника из личного чата (только создатель чата)',
    method: 'delete',
    path: '/api/v1/chat/dms/{id}/members/{userId}',
    shape: { id, userId: id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string };
      await dmOf(d, u, a.id);
      await d.run(
        u,
        [{ name: 'chat.dm.removeMember', args: { channelId: a.id, userId: a.userId } }],
        t,
      );
      return undefined;
    },
  },
  {
    tool: 'leave_chat_dm',
    description: 'Выйти из личного чата',
    method: 'delete',
    path: '/api/v1/chat/dms/{id}/membership',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await dmOf(d, u, a.id);
      await d.run(u, [{ name: 'chat.dm.leave', args: { channelId: a.id } }], t);
      return undefined;
    },
  },
  {
    tool: 'mute_chat',
    description: 'Выключить или включить уведомления канала / личного чата для себя',
    method: 'put',
    path: '/api/v1/chat/channels/{id}/mute',
    shape: { id, muted: z.boolean() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; muted: boolean };
      await channelOf(d, u, a.id);
      await d.run(
        u,
        [{ name: 'chat.mute', args: { id: uuidv7(), channelId: a.id, muted: a.muted } }],
        t,
      );
      return { id: a.id, muted: a.muted };
    },
  },
  {
    tool: 'mark_chat_read',
    description:
      'Отметить канал прочитанным до сообщения lastReadSeq (по умолчанию — до последнего)',
    method: 'post',
    path: '/api/v1/chat/channels/{id}/read',
    shape: { id, lastReadSeq: z.number().int().min(0).optional() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; lastReadSeq?: number };
      const c = await channelOf(d, u, a.id);
      const seq = a.lastReadSeq ?? (c.lastSeq as number);
      await d.run(
        u,
        [{ name: 'chat.read', args: { id: uuidv7(), channelId: a.id, lastReadSeq: seq } }],
        t,
      );
      const rc = cols('chatReads');
      const [r] = await wireRows(d, 'chatReads', and(eq(rc.userId!, u), eq(rc.channelId!, a.id))!, [
        rc.updatedAt!,
      ]);
      return { id: a.id, lastReadSeq: r?.lastReadSeq ?? 0 };
    },
  },
  {
    tool: 'list_chat_messages',
    description:
      'Сообщения канала (без ответов в тредах), от старых к новым; before — seq, раньше которого читать; с реакциями',
    method: 'get',
    path: '/api/v1/chat/channels/{id}/messages',
    shape: {
      id,
      before: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string; before?: number; limit: number };
      await channelOf(d, u, a.id);
      const m = cols('chatMessages');
      const rows = await wireRows(
        d,
        'chatMessages',
        and(
          eq(m.channelId!, a.id),
          isNull(m.parentId!),
          a.before === undefined ? undefined : lt(m.seq!, a.before),
        )!,
        [desc(m.seq!) as never],
      );
      const page = rows.slice(0, a.limit).reverse();
      return {
        messages: page,
        reactions: await reactionsOf(
          d,
          page.map((r) => r.id as string),
        ),
      };
    },
  },
  {
    tool: 'get_chat_thread',
    description: 'Тред: корневое сообщение и ответы с реакциями',
    method: 'get',
    path: '/api/v1/chat/messages/{id}/thread',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const root = await messageOf(d, u, (i as { id: string }).id);
      if (root.parentId) throw notFound('Сообщение');
      const m = cols('chatMessages');
      const replies = await wireRows(d, 'chatMessages', eq(m.parentId!, root.id as string), [
        asc(m.createdAt!) as never,
      ]);
      return {
        root: await wireRow(d, 'chatMessages', root.id as string),
        replies,
        reactions: await reactionsOf(d, [root.id as string, ...replies.map((r) => r.id as string)]),
      };
    },
  },
  {
    tool: 'send_chat_message',
    description:
      'Отправить сообщение в канал или личный чат; parentId — ответ в треде корневого сообщения',
    method: 'post',
    path: '/api/v1/chat/channels/{id}/messages',
    shape: { id, text, parentId: id.nullable().optional() },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const a = i as { id: string; text: string; parentId?: string | null };
      await channelOf(d, u, a.id);
      const mid = uuidv7();
      const args = {
        id: mid,
        channelId: a.id,
        body: docOf(a.text),
        readId: uuidv7(),
        parentId: a.parentId ?? null,
      };
      await d.run(u, [{ name: 'chat.message.send', args }], t);
      return wireRow(d, 'chatMessages', mid);
    },
  },
  {
    tool: 'edit_chat_message',
    description: 'Изменить своё сообщение',
    method: 'patch',
    path: '/api/v1/chat/messages/{id}',
    shape: { id, text },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; text: string };
      await messageOf(d, u, a.id);
      await d.run(u, [{ name: 'chat.message.update', args: { id: a.id, body: docOf(a.text) } }], t);
      return wireRow(d, 'chatMessages', a.id);
    },
  },
  {
    tool: 'delete_chat_message',
    description: 'Удалить своё сообщение (текст и реакции стираются, место в ленте остаётся)',
    method: 'delete',
    path: '/api/v1/chat/messages/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await messageOf(d, u, a.id);
      await d.run(u, [{ name: 'chat.message.delete', args: a }], t);
      return undefined;
    },
  },
  {
    tool: 'toggle_chat_reaction',
    description:
      'Поставить реакцию (emoji) на сообщение или снять свою, если уже стоит; возвращает реакции сообщения',
    method: 'put',
    path: '/api/v1/chat/messages/{id}/reactions',
    shape: { id, emoji: z.string().min(1).max(32) },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; emoji: string };
      await messageOf(d, u, a.id);
      const args = { id: uuidv7(), messageId: a.id, emoji: a.emoji };
      await d.run(u, [{ name: 'chat.reaction.toggle', args }], t);
      return reactionsOf(d, [a.id]);
    },
  },
];

export const area: ExtArea = { name: 'chat', ops };
