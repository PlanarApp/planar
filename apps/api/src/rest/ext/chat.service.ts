import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { cols, notFound, rawRow, wireRows } from './planning.service.js';
import type { ExtDeps } from './types.js';

/** channel visible to the user: a space member (and the project, if any, is visible) or a dialog member — as in modules/chat canSee */
const seen = (userId: string): SQL => sql`(
  (chat_channels.space_id is not null and exists (
    select 1 from space_members m where m.space_id = chat_channels.space_id and m.user_id = ${userId})
    and (chat_channels.project_id is null
      or project_role(${userId}::uuid, chat_channels.project_id) is not null))
  or (chat_channels.space_id is null and exists (
    select 1 from chat_members m where m.channel_id = chat_channels.id and m.user_id = ${userId})))`;

export async function visibleChannels(d: ExtDeps, userId: string, extra?: SQL) {
  const c = cols('chatChannels');
  return wireRows(d, 'chatChannels', and(seen(userId), extra)!, [
    desc(sql`coalesce(${c.lastMessageAt!}, ${c.createdAt!})`) as never,
  ]);
}

/** raw channel the user sees, else 404 */
export async function channelOf(d: ExtDeps, userId: string, id: string) {
  const c = await rawRow(d, 'chatChannels', id);
  if (!c || !(await visibleChannels(d, userId, eq(cols('chatChannels').id!, id))).length)
    throw notFound('Канал');
  return c;
}

/** raw message of a channel the user sees, else 404 */
export async function messageOf(d: ExtDeps, userId: string, id: string) {
  const m = await rawRow(d, 'chatMessages', id);
  if (!m) throw notFound('Сообщение');
  await channelOf(d, userId, m.channelId as string).catch(() => {
    throw notFound('Сообщение');
  });
  return m;
}

export async function reactionsOf(d: ExtDeps, ids: string[]) {
  if (!ids.length) return [];
  const r = cols('chatReactions');
  return wireRows(d, 'chatReactions', inArray(r.messageId!, ids), [r.createdAt!]);
}

/** plain text → a doc body: a paragraph per line */
export const docOf = (text: string) => ({
  type: 'doc' as const,
  content: text.split('\n').map((l) => ({
    type: 'paragraph',
    content: l ? [{ type: 'text', text: l }] : [],
  })),
});
