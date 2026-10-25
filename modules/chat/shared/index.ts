import { z } from 'zod';
import {
  defineMutator,
  extractMentions,
  MutatorError,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const int = z.number().int();
const doc = z.looseObject({ type: z.literal('doc'), content: z.array(z.unknown()).optional() });
const attachment = z.object({
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string(),
  mime: z.string(),
  size: int.nonnegative(),
  width: int.optional(),
  height: int.optional(),
});

export const chatChannels = z.object({
  id: z.uuid(),
  spaceId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  kind: z.enum(['channel', 'dm']),
  name: z.string().min(1).max(80).nullable(),
  topic: z.string().max(250).nullable(),
  createdBy: z.uuid(),
  lastSeq: int.nonnegative(),
  lastMessageAt: ts.nullable(),
  archivedAt: ts.nullable(),
  createdAt: ts,
  updatedAt: ts,
});
export const chatMembers = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  userId: z.uuid(),
  addedBy: z.uuid(),
  createdAt: ts,
});
export const chatMessages = z.object({
  id: z.uuid(),
  spaceId: z.uuid().nullable(),
  channelId: z.uuid(),
  parentId: z.uuid().nullable(),
  seq: int.nullable(),
  authorId: z.uuid(),
  body: doc,
  mentions: z.array(z.uuid()),
  attachments: z.array(attachment).max(10),
  replyCount: int.nonnegative(),
  lastReplyAt: ts.nullable(),
  editedAt: ts.nullable(),
  deletedAt: ts.nullable(),
  createdAt: ts,
  updatedAt: ts,
});
export const chatReactions = z.object({
  id: z.uuid(),
  spaceId: z.uuid().nullable(),
  channelId: z.uuid(),
  messageId: z.uuid(),
  userId: z.uuid(),
  emoji: z.string().min(1).max(32),
  createdAt: ts,
});
export const chatReads = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  channelId: z.uuid(),
  lastReadSeq: int.nonnegative(),
  muted: z.boolean(),
  updatedAt: ts,
});

type Channel = z.infer<typeof chatChannels>;
type Member = z.infer<typeof chatMembers>;
type Message = z.infer<typeof chatMessages>;
type Reaction = z.infer<typeof chatReactions>;
type Read = z.infer<typeof chatReads>;

// Tx типизирован сущностями ядра; сущности модулей приводим (C-modules)
interface ChatTx {
  get<T>(e: string, id: string): Promise<T | undefined>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, partial: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan<T>(e: string, opts?: { index: string; eq: unknown }): Promise<T[]>;
}
const ctx_ = (tx: Tx) => tx as unknown as ChatTx;

const MAX_BODY = 64 * 1024;
const MAX_DM = 8;
const emptyDoc = () => ({ type: 'doc' as const, content: [] });

const checkBody = (body: unknown) => {
  if (JSON.stringify(body).length > MAX_BODY)
    throw new MutatorError('invalid_args', 'body > 64 КБ');
};

async function channel(tx: Tx, id: string): Promise<Channel> {
  const c = await ctx_(tx).get<Channel>('chatChannels', id);
  if (!c) throw new MutatorError('not_found', 'канал не найден');
  return c;
}

/** Кто видит канал: участники пространства или участники диалога. */
async function viewers(tx: Tx, c: Channel): Promise<Set<string>> {
  const rows = c.spaceId
    ? await tx.scan('spaceMembers', { index: 'spaceId', eq: c.spaceId })
    : await ctx_(tx).scan<Member>('chatMembers', { index: 'channelId', eq: c.id });
  return new Set(rows.map((r) => r.userId));
}

/** Канал, который видит ctx.userId, иначе forbidden. */
async function visible(tx: Tx, id: string, userId: string) {
  const c = await channel(tx, id);
  const v = await viewers(tx, c);
  if (!v.has(userId)) throw new MutatorError('forbidden', 'нет доступа к каналу');
  return { c, v };
}

async function message(tx: Tx, id: string): Promise<Message> {
  const m = await ctx_(tx).get<Message>('chatMessages', id);
  if (!m) throw new MutatorError('not_found', 'сообщение не найдено');
  return m;
}

const mentionsOf = (body: unknown, v: Set<string>) => extractMentions(body).filter((u) => v.has(u));

/** Своя chatReads канала (на сервере scan видит все строки — фильтр по userId). */
async function myRead(tx: Tx, channelId: string, userId: string): Promise<Read | undefined> {
  const rows = await ctx_(tx).scan<Read>('chatReads', { index: 'channelId', eq: channelId });
  return rows.find((r) => r.userId === userId);
}

const createChannel = defineMutator({
  name: 'chat.channel.create',
  args: z.object({
    id: z.uuid(),
    spaceId: z.uuid(),
    projectId: z.uuid().nullable().optional(),
    name: z.string(),
    topic: z.string().max(250).nullable().optional(),
  }),
  async run(tx, a, ctx) {
    if (a.projectId && (await tx.get('projects', a.projectId))?.spaceId !== a.spaceId)
      throw new MutatorError('invalid_args', 'проект другого пространства');
    const me = (await tx.scan('spaceMembers', { index: 'spaceId', eq: a.spaceId })).find(
      (m) => m.userId === ctx.userId,
    );
    if (!me || me.role === 'guest') throw new MutatorError('forbidden', 'нужна роль member');
    const name = a.name.trim();
    if (name.length < 1 || name.length > 80) throw new MutatorError('invalid_args', 'name 1–80');
    const row: Channel = {
      id: a.id,
      spaceId: a.spaceId,
      projectId: a.projectId ?? null,
      kind: 'channel',
      name,
      topic: a.topic ?? null,
      createdBy: ctx.userId,
      lastSeq: 0,
      lastMessageAt: null,
      archivedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    await ctx_(tx).put('chatChannels', row);
  },
});

const updateChannel = defineMutator({
  name: 'chat.channel.update',
  args: z.object({
    id: z.uuid(),
    name: z.string().optional(),
    topic: z.string().max(250).nullable().optional(),
    archivedAt: ts.nullable().optional(),
  }),
  async run(tx, a, ctx) {
    const c = await channel(tx, a.id);
    if (c.kind !== 'channel') throw new MutatorError('invalid_args', 'не канал');
    const me = (await tx.scan('spaceMembers', { index: 'spaceId', eq: c.spaceId })).find(
      (m) => m.userId === ctx.userId,
    );
    if (c.createdBy !== ctx.userId && me?.role !== 'admin')
      throw new MutatorError('forbidden', 'только создатель или admin');
    const patch: Partial<Channel> = { updatedAt: ctx.now };
    if (a.name !== undefined) {
      const name = a.name.trim();
      if (name.length < 1 || name.length > 80) throw new MutatorError('invalid_args', 'name 1–80');
      patch.name = name;
    }
    if (a.topic !== undefined) patch.topic = a.topic;
    if (a.archivedAt !== undefined) patch.archivedAt = a.archivedAt;
    await ctx_(tx).patch('chatChannels', a.id, patch);
  },
});

const createDm = defineMutator({
  name: 'chat.dm.create',
  args: z.object({
    id: z.uuid(),
    members: z
      .array(z.object({ id: z.uuid(), userId: z.uuid() }))
      .min(2)
      .max(MAX_DM),
  }),
  async run(tx, a, ctx) {
    const ids = new Set(a.members.map((m) => m.userId));
    if (ids.size !== a.members.length || !ids.has(ctx.userId))
      throw new MutatorError('invalid_args', 'участники: без повторов, включая себя');
    for (const id of ids) {
      const u = await tx.get('users', id);
      if (!u || u.deactivatedAt) throw new MutatorError('invalid_args', 'пользователь недоступен');
    }
    const row: Channel = {
      id: a.id,
      spaceId: null,
      projectId: null,
      kind: 'dm',
      name: null,
      topic: null,
      createdBy: ctx.userId,
      lastSeq: 0,
      lastMessageAt: null,
      archivedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    await ctx_(tx).put('chatChannels', row);
    for (const m of a.members) {
      const mem: Member = {
        id: m.id,
        channelId: a.id,
        userId: m.userId,
        addedBy: ctx.userId,
        createdAt: ctx.now,
      };
      await ctx_(tx).put('chatMembers', mem);
    }
  },
});

const addMember = defineMutator({
  name: 'chat.dm.addMember',
  args: z.object({ id: z.uuid(), channelId: z.uuid(), userId: z.uuid() }),
  async run(tx, a, ctx) {
    const { c, v } = await visible(tx, a.channelId, ctx.userId);
    if (c.kind !== 'dm') throw new MutatorError('invalid_args', 'не диалог');
    if (v.has(a.userId)) return;
    if (v.size + 1 > MAX_DM) throw new MutatorError('conflict', 'в диалоге не больше 8');
    const u = await tx.get('users', a.userId);
    if (!u || u.deactivatedAt) throw new MutatorError('invalid_args', 'пользователь недоступен');
    const mem: Member = {
      id: a.id,
      channelId: a.channelId,
      userId: a.userId,
      addedBy: ctx.userId,
      createdAt: ctx.now,
    };
    await ctx_(tx).put('chatMembers', mem);
  },
});

const leaveDm = defineMutator({
  name: 'chat.dm.leave',
  args: z.object({ channelId: z.uuid() }),
  async run(tx, a, ctx) {
    const rows = await ctx_(tx).scan<Member>('chatMembers', {
      index: 'channelId',
      eq: a.channelId,
    });
    for (const m of rows) if (m.userId === ctx.userId) await ctx_(tx).del('chatMembers', m.id);
  },
});

const send = defineMutator({
  name: 'chat.message.send',
  args: z.object({
    id: z.uuid(),
    channelId: z.uuid(),
    body: doc,
    readId: z.uuid(),
    parentId: z.uuid().nullable().optional(),
    attachments: z.array(attachment).max(10).optional(),
  }),
  async run(tx, a, ctx) {
    // CL-2b: каждое обращение к IndexedDB ≈ 1 мс на клиенте — читаем канал и свою chatReads вместе,
    // viewers на клиенте нужны только ради mentions (сервер пересчитывает и проверяет доступ сам)
    const [c, mine] = await Promise.all([
      channel(tx, a.channelId),
      myRead(tx, a.channelId, ctx.userId),
    ]);
    const mentioned = extractMentions(a.body);
    const v = ctx.server || mentioned.length ? await viewers(tx, c) : undefined;
    if (v && !v.has(ctx.userId)) throw new MutatorError('forbidden', 'нет доступа к каналу');
    if (c.archivedAt) throw new MutatorError('conflict', 'канал в архиве');
    checkBody(a.body);
    let root: Message | undefined;
    if (a.parentId) {
      root = await ctx_(tx).get<Message>('chatMessages', a.parentId);
      if (!root || root.channelId !== c.id || root.parentId)
        throw new MutatorError('invalid_args', 'родитель недопустим');
    }
    const seq = root ? null : c.lastSeq + 1;
    const row: Message = {
      id: a.id,
      spaceId: c.spaceId,
      channelId: c.id,
      parentId: root?.id ?? null,
      seq,
      authorId: ctx.userId,
      body: a.body,
      mentions: v ? mentioned.filter((u) => v.has(u)) : [],
      attachments: a.attachments ?? [],
      replyCount: 0,
      lastReplyAt: null,
      editedAt: null,
      deletedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    // записи независимы: на клиенте идут разом (IndexedDB конвейеризует запросы одной транзакции),
    // на сервере — по порядку: от него зависит порядок строк changes
    const writes: Promise<void>[] = [];
    const w = (p: () => Promise<void>) => (ctx.server ? p() : void writes.push(p()));
    await w(() => ctx_(tx).put('chatMessages', row));
    if (root)
      await w(() =>
        ctx_(tx).patch('chatMessages', root.id, {
          replyCount: root.replyCount + 1,
          lastReplyAt: ctx.now,
          updatedAt: ctx.now,
        }),
      );
    else {
      // put по уже прочитанной строке — без повторного get, который делает patch
      await w(() =>
        ctx_(tx).put('chatChannels', {
          ...c,
          lastSeq: seq,
          lastMessageAt: ctx.now,
          updatedAt: ctx.now,
        }),
      );
      if (mine) {
        if (mine.lastReadSeq < seq!)
          await w(() =>
            ctx_(tx).put('chatReads', { ...mine, lastReadSeq: seq, updatedAt: ctx.now }),
          );
      } else {
        const r: Read = {
          id: a.readId,
          userId: ctx.userId,
          channelId: c.id,
          lastReadSeq: seq!,
          muted: false,
          updatedAt: ctx.now,
        };
        await w(() => ctx_(tx).put('chatReads', r));
      }
    }
    await Promise.all(writes);
  },
});

const update = defineMutator({
  name: 'chat.message.update',
  args: z.object({ id: z.uuid(), body: doc }),
  async run(tx, a, ctx) {
    const m = await message(tx, a.id);
    if (m.authorId !== ctx.userId) throw new MutatorError('forbidden', 'не автор');
    if (m.deletedAt) throw new MutatorError('conflict', 'сообщение удалено');
    checkBody(a.body);
    const { v } = await visible(tx, m.channelId, ctx.userId);
    await ctx_(tx).patch('chatMessages', a.id, {
      body: a.body,
      mentions: mentionsOf(a.body, v),
      editedAt: ctx.now,
      updatedAt: ctx.now,
    });
  },
});

const remove = defineMutator({
  name: 'chat.message.delete',
  args: z.object({ id: z.uuid() }),
  async run(tx, a, ctx) {
    const m = await message(tx, a.id);
    if (m.authorId !== ctx.userId) throw new MutatorError('forbidden', 'не автор');
    if (m.deletedAt) return;
    const rs = await ctx_(tx).scan<Reaction>('chatReactions', { index: 'messageId', eq: a.id });
    for (const r of rs) await ctx_(tx).del('chatReactions', r.id);
    await ctx_(tx).patch('chatMessages', a.id, {
      body: emptyDoc(),
      mentions: [],
      attachments: [],
      deletedAt: ctx.now,
      updatedAt: ctx.now,
    });
  },
});

const toggle = defineMutator({
  name: 'chat.reaction.toggle',
  args: z.object({ id: z.uuid(), messageId: z.uuid(), emoji: z.string().min(1).max(32) }),
  async run(tx, a, ctx) {
    const m = await message(tx, a.messageId);
    await visible(tx, m.channelId, ctx.userId);
    if (m.deletedAt) throw new MutatorError('conflict', 'сообщение удалено');
    const rs = await ctx_(tx).scan<Reaction>('chatReactions', { index: 'messageId', eq: m.id });
    const mine = rs.find((r) => r.userId === ctx.userId && r.emoji === a.emoji);
    if (mine) return ctx_(tx).del('chatReactions', mine.id);
    const row: Reaction = {
      id: a.id,
      spaceId: m.spaceId,
      channelId: m.channelId,
      messageId: m.id,
      userId: ctx.userId,
      emoji: a.emoji,
      createdAt: ctx.now,
    };
    await ctx_(tx).put('chatReactions', row);
  },
});

const read = defineMutator({
  name: 'chat.read',
  args: z.object({ id: z.uuid(), channelId: z.uuid(), lastReadSeq: int.nonnegative() }),
  async run(tx, a, ctx) {
    const { c } = await visible(tx, a.channelId, ctx.userId);
    const mine = await myRead(tx, c.id, ctx.userId);
    const next = Math.min(Math.max(mine?.lastReadSeq ?? 0, a.lastReadSeq), c.lastSeq);
    if (!mine)
      return ctx_(tx).put('chatReads', {
        id: a.id,
        userId: ctx.userId,
        channelId: c.id,
        lastReadSeq: next,
        muted: false,
        updatedAt: ctx.now,
      } satisfies Read);
    if (next !== mine.lastReadSeq)
      await ctx_(tx).patch('chatReads', mine.id, { lastReadSeq: next, updatedAt: ctx.now });
  },
});

const mute = defineMutator({
  name: 'chat.mute',
  args: z.object({ id: z.uuid(), channelId: z.uuid(), muted: z.boolean() }),
  async run(tx, a, ctx) {
    const { c } = await visible(tx, a.channelId, ctx.userId);
    const mine = await myRead(tx, c.id, ctx.userId);
    if (mine) await ctx_(tx).patch('chatReads', mine.id, { muted: a.muted, updatedAt: ctx.now });
    else
      await ctx_(tx).put('chatReads', {
        id: a.id,
        userId: ctx.userId,
        channelId: c.id,
        lastReadSeq: 0,
        muted: a.muted,
        updatedAt: ctx.now,
      } satisfies Read);
  },
});

const members = (via: string) => ({
  entity: 'chatMembers',
  key: 'channelId',
  container: 'chatChannels',
  via,
});

export const shared: SharedModuleManifest = {
  id: 'chat',
  mutators: [
    createChannel,
    updateChannel,
    createDm,
    addMember,
    leaveDm,
    send,
    update,
    remove,
    toggle,
    read,
    mute,
  ],
  entities: {
    chatChannels: {
      schema: chatChannels,
      meta: {
        scope: 'space|members',
        write: 'guest',
        bootstrap: true,
        indexes: ['spaceId'],
        members: members('id'),
      },
    },
    chatMembers: {
      schema: chatMembers,
      meta: {
        scope: 'space|members',
        write: 'guest',
        bootstrap: true,
        indexes: ['channelId', 'userId'],
        members: members('channelId'),
      },
    },
    chatMessages: {
      schema: chatMessages,
      meta: {
        scope: 'space|members',
        write: 'guest',
        bootstrap: false,
        indexes: ['channelId', 'parentId'],
        members: members('channelId'),
      },
    },
    chatReactions: {
      schema: chatReactions,
      meta: {
        scope: 'space|members',
        write: 'guest',
        bootstrap: false,
        indexes: ['messageId'],
        members: members('channelId'),
      },
    },
    chatReads: {
      schema: chatReads,
      meta: { scope: 'user', write: 'self', bootstrap: true, indexes: ['channelId'] },
    },
  },
};
