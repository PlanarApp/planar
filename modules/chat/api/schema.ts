import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const chatChannels = pgTable(
  'chat_channels',
  {
    id: uuid().primaryKey(),
    spaceId: uuid(),
    projectId: uuid(),
    kind: text().notNull(),
    name: text(),
    topic: text(),
    createdBy: uuid().notNull(),
    lastSeq: integer().notNull(),
    lastMessageAt: ts(),
    archivedAt: ts(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('chat_channels_space_id_idx').on(t.spaceId)],
);

export const chatMembers = pgTable(
  'chat_members',
  {
    id: uuid().primaryKey(),
    channelId: uuid()
      .notNull()
      .references(() => chatChannels.id),
    userId: uuid().notNull(),
    addedBy: uuid().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [
    uniqueIndex('chat_members_channel_user_uq').on(t.channelId, t.userId),
    index('chat_members_channel_id_idx').on(t.channelId),
    index('chat_members_user_id_idx').on(t.userId),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid().primaryKey(),
    spaceId: uuid(),
    channelId: uuid()
      .notNull()
      .references(() => chatChannels.id),
    parentId: uuid().references((): AnyPgColumn => chatMessages.id),
    seq: integer(),
    authorId: uuid().notNull(),
    body: jsonb().$type<Record<string, unknown>>().notNull(),
    mentions: jsonb().$type<string[]>().notNull(),
    attachments: jsonb().$type<unknown[]>().notNull(),
    replyCount: integer().notNull(),
    lastReplyAt: ts(),
    editedAt: ts(),
    deletedAt: ts(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    // uniqueness guards against two messages with one seq in a race; replies have seq null
    uniqueIndex('chat_messages_channel_seq_uq').on(t.channelId, t.seq),
    index('chat_messages_parent_id_idx').on(t.parentId),
  ],
);

export const chatReactions = pgTable(
  'chat_reactions',
  {
    id: uuid().primaryKey(),
    spaceId: uuid(),
    channelId: uuid()
      .notNull()
      .references(() => chatChannels.id),
    messageId: uuid()
      .notNull()
      .references(() => chatMessages.id),
    userId: uuid().notNull(),
    emoji: text().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [
    uniqueIndex('chat_reactions_message_user_emoji_uq').on(t.messageId, t.userId, t.emoji),
    index('chat_reactions_message_id_idx').on(t.messageId),
  ],
);

export const chatReads = pgTable(
  'chat_reads',
  {
    id: uuid().primaryKey(),
    userId: uuid().notNull(),
    channelId: uuid().notNull(),
    lastReadSeq: integer().notNull(),
    muted: boolean().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    uniqueIndex('chat_reads_user_channel_uq').on(t.userId, t.channelId),
    index('chat_reads_channel_id_idx').on(t.channelId),
  ],
);
