import { Controller, Get, Inject, Module, Param, Query, Req } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { uuidv7, type BackendModuleManifest } from '@planar/shared';
import { CORE, HttpError, type CoreServices, type ModuleHookApi, type Q } from '@planar/server-kit';
import { z } from 'zod';
import { shared } from '../shared/index.js';
import { chatMessages, chatReactions } from './schema.js';

type Wire = Record<string, unknown>;

/** Видит ли userId канал: участник пространства или участник диалога. */
const canSee = (channelId: SQL | string, userId: string) => sql`
  select 1 from chat_channels c where c.id = ${channelId} and (
    (c.space_id is not null and exists (
      select 1 from space_members m where m.space_id = c.space_id and m.user_id = ${userId}))
    or (c.space_id is null and exists (
      select 1 from chat_members m where m.channel_id = c.id and m.user_id = ${userId})))`;

// timestamptz из pg ("2026-10-22 10:00:00.123+00") → ISO UTC, как toWire ядра
const TS = ['createdAt', 'updatedAt', 'lastReplyAt', 'editedAt', 'deletedAt'];
function wire<T extends object>(r: T): Wire {
  const out = { ...r } as Wire;
  for (const k of TS) {
    const v = out[k];
    if (typeof v === 'string') {
      const t = v.replace(' ', 'T');
      out[k] = new Date(/[+-]\d\d$/.test(t) ? `${t}:00` : t).toISOString();
    }
  }
  return out;
}

const query = z.object({
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller('api/chat')
class ChatController {
  constructor(@Inject(CORE) private readonly core: CoreServices) {}

  private get db() {
    return this.core.db;
  }

  private async channelFor(req: object, channelId: string) {
    const { userId } = this.core.auth(req);
    if (!z.uuid().safeParse(channelId).success) throw new HttpError(404, 'not_found', 'не найдено');
    if (!(await this.db.execute(canSee(channelId, userId))).rows.length)
      throw new HttpError(404, 'not_found', 'канал не найден');
  }

  private async reactionsOf(ids: string[]) {
    if (!ids.length) return [];
    const rs = await this.db
      .select()
      .from(chatReactions)
      .where(inArray(chatReactions.messageId, ids));
    return rs.map(wire);
  }

  @Get('channels/:id/messages')
  async history(@Req() req: object, @Param('id') id: string, @Query() q: unknown) {
    const p = query.safeParse(q);
    if (!p.success) throw new HttpError(400, 'invalid_request', 'before/limit некорректны');
    await this.channelFor(req, id);
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.channelId, id),
          isNull(chatMessages.parentId),
          p.data.before === undefined ? undefined : lt(chatMessages.seq, p.data.before),
        ),
      )
      .orderBy(desc(chatMessages.seq))
      .limit(p.data.limit);
    rows.reverse();
    return { messages: rows.map(wire), reactions: await this.reactionsOf(rows.map((r) => r.id)) };
  }

  @Get('messages/:id/thread')
  async thread(@Req() req: object, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success)
      throw new HttpError(404, 'not_found', 'сообщение не найдено');
    const [root] = await this.db.select().from(chatMessages).where(eq(chatMessages.id, id));
    if (!root || root.parentId) throw new HttpError(404, 'not_found', 'сообщение не найдено');
    await this.channelFor(req, root.channelId);
    const replies = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.parentId, id))
      .orderBy(asc(chatMessages.createdAt));
    return {
      root: wire(root),
      replies: replies.map(wire),
      reactions: await this.reactionsOf([root.id, ...replies.map((r) => r.id)]),
    };
  }
}

@Module({ controllers: [ChatController] })
class ChatModule {}

// ---- хук уведомлений ----

// Tx kit типизирован сущностями ядра; сущности чата — по имени строкой
interface Stx {
  get<T>(e: string, id: string): Promise<T | undefined>;
  put(e: string, row: unknown): Promise<void>;
  scan<T>(e: string, opts: { index: string; eq: unknown }): Promise<T[]>;
}
type Msg = {
  id: string;
  channelId: string;
  parentId: string | null;
  authorId: string;
  body: unknown;
  mentions: string[];
  editedAt: string | null;
  deletedAt: string | null;
};
type Chan = { id: string; spaceId: string | null; kind: 'channel' | 'dm' };

/** Текст узлов body (mention — @метка), абзацы через пробел. */
function plain(n: unknown): string {
  const o = n as { type?: string; text?: string; attrs?: { label?: string }; content?: unknown[] };
  if (o?.type === 'text') return o.text ?? '';
  if (o?.type === 'mention') return `@${o.attrs?.label ?? ''}`;
  return (o?.content ?? []).map(plain).join(o?.type === 'doc' ? ' ' : '');
}

async function notify(
  writes: { entity: string; op: string; before: Wire | null; after: Wire | null }[],
  ctx: { userId: string; now: string },
  api: ModuleHookApi,
) {
  const sys = api.sys as unknown as Stx;
  for (const w of writes) {
    if (w.entity !== 'chatMessages' || w.op !== 'put' || !w.after) continue;
    const m = w.after as unknown as Msg;
    const before = w.before as unknown as Msg | null;
    if (m.deletedAt) continue;
    const created = !before;
    // правка: только новые упомянутые; прочие изменения (replyCount корня) — не сообщения
    if (!created && m.editedAt === before.editedAt) continue;
    const ch = await sys.get<Chan>('chatChannels', m.channelId);
    if (!ch) continue;
    const fresh = created ? m.mentions : m.mentions.filter((u) => !before.mentions.includes(u));
    // обычное сообщение канала без упоминаний никого не уведомляет — без сканов участников и muted
    if (!fresh.length && !(created && (ch.kind === 'dm' || m.parentId))) continue;
    const seeing = new Set(
      (ch.spaceId
        ? await sys.scan<{ userId: string }>('spaceMembers', { index: 'spaceId', eq: ch.spaceId })
        : await sys.scan<{ userId: string }>('chatMembers', { index: 'channelId', eq: ch.id })
      ).map((r) => r.userId),
    );
    const muted = new Set(
      (
        await sys.scan<{ userId: string; muted: boolean }>('chatReads', {
          index: 'channelId',
          eq: ch.id,
        })
      )
        .filter((r) => r.muted)
        .map((r) => r.userId),
    );
    const kinds = new Map<string, string>();
    const add = (users: Iterable<string>, kind: string) => {
      for (const u of users)
        if (u !== m.authorId && seeing.has(u) && !muted.has(u) && !kinds.has(u)) kinds.set(u, kind);
    };
    add(fresh, 'chat_mention');
    if (created) {
      // личное — только 1:1; в группе от трёх уведомляет лишь упоминание
      if (ch.kind === 'dm' && seeing.size <= 2) add(seeing, 'chat_dm');
      else if (m.parentId) {
        const root = await sys.get<Msg>('chatMessages', m.parentId);
        const prior = await sys.scan<Msg>('chatMessages', { index: 'parentId', eq: m.parentId });
        add(
          [root?.authorId, ...prior.map((r) => r.authorId)].filter((u): u is string => !!u),
          'chat_reply',
        );
      }
    }
    if (!kinds.size) continue;
    const author = await sys.get<{ name: string }>('users', ctx.userId);
    const body = `${author?.name ?? ''}: ${plain(m.body)}`.slice(0, 140);
    const url = m.parentId ? `/m/chat/c/${ch.id}/t/${m.parentId}` : `/m/chat/c/${ch.id}/${m.id}`;
    for (const [userId, kind] of kinds) {
      const id = uuidv7();
      await sys.put('notifications', {
        id,
        userId,
        spaceId: ch.spaceId,
        kind,
        taskId: null,
        commentId: null,
        changes: null,
        actorId: ctx.userId,
        readAt: null,
        createdAt: ctx.now,
        url,
        body,
      });
      await api.enqueue('push.notification', { notificationId: id });
    }
  }
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: ChatModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: notify as BackendModuleManifest['afterMutation'],
  // файл во вложении сообщения видимого канала, загруженный автором этого сообщения
  async canReadFile(q, userId, sha256) {
    const r = await (q as Q).execute(sql`
        select 1 from chat_messages m
        where m.attachments @> ${JSON.stringify([{ fileSha256: sha256 }])}::jsonb
          and exists (${canSee(sql`m.channel_id`, userId)})
          and exists (
            select 1 from file_uploads fu where fu.sha256 = ${sha256} and fu.user_id = m.author_id)
        limit 1`);
    return r.rows.length > 0;
  },
};
