// Таблицы по C-schema v1 (docs/contracts/core.md). Имя свойства = поле на проводе; колонка — snake_case.
import { sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** rank: ключи fractional-indexing сравниваются побайтно. */
const rank = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true, mode: 'string' });
const createdAt = () => ts().notNull().defaultNow();
const updatedAt = () => ts().notNull().defaultNow();
// значения — литералы контракта; параметры в DDL недопустимы
const inList = (col: unknown, vals: string[]): SQL =>
  sql`${col} in (${sql.raw(vals.map((v) => `'${v}'`).join(', '))})`;
const doc = () => jsonb().$type<Record<string, unknown>>();
const obj = () => jsonb().$type<Record<string, unknown>>();

export const users = pgTable(
  'users',
  {
    id: id(),
    login: text().notNull(),
    name: text().notNull(),
    email: text(),
    role: text().notNull(),
    avatarFile: text(),
    deactivatedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    passwordHash: text().notNull(),
  },
  (t) => [
    uniqueIndex().on(t.login),
    check('users_role_check', inList(t.role, ['owner', 'admin', 'member', 'guest'])),
  ],
);

export const spaces = pgTable('spaces', {
  id: id(),
  name: text().notNull(),
  description: text(),
  color: text(),
  icon: text(),
  rank: rank().notNull(),
  createdBy: uuid()
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const spaceId = () =>
  uuid()
    .notNull()
    .references(() => spaces.id);
const userRef = () => uuid().references(() => users.id);

export const spaceMembers = pgTable(
  'space_members',
  {
    id: id(),
    spaceId: spaceId(),
    userId: userRef().notNull(),
    role: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.spaceId, t.userId),
    index().on(t.userId),
    check('space_members_role_check', inList(t.role, ['admin', 'member', 'guest'])),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    spaceId: spaceId(),
    name: text().notNull(),
    key: text().notNull(),
    description: doc(),
    color: text(),
    icon: text(),
    leadId: userRef(),
    rank: rank().notNull(),
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    taskCounter: integer().notNull().default(0),
  },
  (t) => [uniqueIndex().on(t.key), index().on(t.spaceId)],
);

export const statuses = pgTable(
  'statuses',
  {
    id: id(),
    spaceId: spaceId(),
    name: text().notNull(),
    category: text().notNull(),
    color: text().notNull(),
    rank: rank().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.spaceId),
    check(
      'statuses_category_check',
      inList(t.category, ['backlog', 'todo', 'in_progress', 'done', 'cancelled']),
    ),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    spaceId: spaceId(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    number: integer(),
    parentId: uuid().references((): AnyPgColumn => tasks.id),
    statusId: uuid()
      .notNull()
      .references(() => statuses.id),
    title: text().notNull(),
    description: doc(),
    priority: integer().notNull(),
    rank: rank().notNull(),
    dueDate: date({ mode: 'string' }),
    startDate: date({ mode: 'string' }),
    createdBy: userRef().notNull(),
    completedAt: ts(),
    fields: obj().notNull().default({}),
    cycleId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.projectId, t.number),
    index().on(t.spaceId),
    index().on(t.parentId),
    index().on(t.statusId),
    index().on(t.cycleId),
  ],
);

const taskRef = () =>
  uuid()
    .notNull()
    .references(() => tasks.id);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: taskRef(),
    userId: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.taskId, t.userId), index().on(t.userId)],
);

export const taskWatchers = pgTable(
  'task_watchers',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: taskRef(),
    userId: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.taskId, t.userId), index().on(t.userId)],
);

export const labels = pgTable(
  'labels',
  {
    id: id(),
    spaceId: spaceId(),
    name: text().notNull(),
    color: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.spaceId)],
);

export const taskLabels = pgTable(
  'task_labels',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: taskRef(),
    labelId: uuid()
      .notNull()
      .references(() => labels.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.taskId, t.labelId), index().on(t.labelId)],
);

export const fieldDefs = pgTable(
  'field_defs',
  {
    id: id(),
    spaceId: spaceId(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    type: text().notNull(),
    options: obj().notNull(),
    rank: rank().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.spaceId),
    index().on(t.projectId),
    check(
      'field_defs_type_check',
      inList(t.type, ['text', 'number', 'date', 'select', 'user', 'url', 'money']),
    ),
  ],
);

export const taskLinks = pgTable(
  'task_links',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: taskRef(),
    targetId: taskRef(),
    kind: text().notNull(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // одна строка на пару в любом направлении
    uniqueIndex('task_links_pair_uq').on(
      sql`least(${t.taskId}, ${t.targetId})`,
      sql`greatest(${t.taskId}, ${t.targetId})`,
    ),
    index().on(t.taskId),
    index().on(t.targetId),
    check('task_links_kind_check', inList(t.kind, ['blocks', 'relates', 'duplicates'])),
    check('task_links_self_check', sql`${t.taskId} <> ${t.targetId}`),
  ],
);

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: taskRef(),
    text: text().notNull(),
    done: boolean().notNull(),
    rank: rank().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.taskId)],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: taskRef(),
    authorId: userRef().notNull(),
    parentId: uuid(),
    body: jsonb().$type<Record<string, unknown>>().notNull(),
    mentions: uuid()
      .array()
      .notNull()
      .default(sql`'{}'`),
    assigneeId: uuid(),
    resolvedAt: ts(),
    resolvedBy: uuid(),
    editedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.taskId)],
);

export const commentReactions = pgTable(
  'comment_reactions',
  {
    id: id(),
    spaceId: spaceId(),
    commentId: uuid()
      .notNull()
      .references(() => comments.id),
    userId: userRef().notNull(),
    emoji: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.commentId, t.userId, t.emoji)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: taskRef(),
    commentId: uuid().references(() => comments.id),
    fileSha256: text().notNull(),
    name: text().notNull(),
    mime: text().notNull(),
    size: bigint({ mode: 'number' }).notNull(),
    width: integer(),
    height: integer(),
    uploadedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.taskId), index().on(t.commentId)],
);

export const activity = pgTable(
  'activity',
  {
    id: id(),
    spaceId: spaceId(),
    taskId: uuid().notNull(),
    actorId: userRef().notNull(),
    kind: text().notNull(),
    changes: obj().notNull(),
    viaTokenId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.taskId),
    check(
      'activity_kind_check',
      inList(t.kind, [
        'created',
        'updated',
        'deleted',
        'assignee_added',
        'assignee_removed',
        'label_added',
        'label_removed',
        'commented',
      ]),
    ),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: userRef().notNull(),
    spaceId: uuid().references(() => spaces.id),
    kind: text().notNull(),
    taskId: uuid(),
    url: text(),
    body: text(),
    commentId: uuid(),
    changes: obj(),
    actorId: userRef().notNull(),
    readAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.taskId),
    index().on(t.userId, t.createdAt),
    check(
      'notifications_kind_check',
      inList(t.kind, [
        'assigned',
        'mentioned',
        'commented',
        'status_changed',
        'chat_mention',
        'chat_dm',
        'chat_reply',
        'comment_assigned',
        'doc_mention',
      ]),
    ),
  ],
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: id(),
    spaceId: spaceId(),
    userId: userRef(),
    createdBy: userRef().notNull(),
    name: text().notNull(),
    layout: text().notNull(),
    filter: obj().notNull(),
    config: obj().notNull(),
    rank: rank().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.spaceId)],
);

export const settings = pgTable('settings', {
  id: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

// Несинхронизируемые таблицы (только сервер): ссылки на users — ON DELETE CASCADE.
const cascadeUser = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey(),
    userId: cascadeUser(),
    createdAt: createdAt(),
    expiresAt: ts().notNull(),
    lastSeenAt: ts().notNull().defaultNow(),
    userAgent: text(),
  },
  (t) => [index().on(t.userId)],
);

/** Состояние Y.Doc совместного редактирования (P3-ydoc): doc_id = `docs:<uuid>` | `task:<uuid>`. */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
export const ydocs = pgTable('ydocs', {
  docId: text().primaryKey(),
  state: bytea().notNull(),
  updatedAt: updatedAt(),
});

export const files = pgTable('files', {
  sha256: text().primaryKey(),
  size: bigint({ mode: 'number' }).notNull(),
  mime: text().notNull(),
  width: integer(),
  height: integer(),
  createdBy: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

export const fileUploads = pgTable(
  'file_uploads',
  {
    sha256: text()
      .notNull()
      .references(() => files.sha256, { onDelete: 'cascade' }),
    userId: cascadeUser(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sha256, t.userId] })],
);

export const loginAttempts = pgTable('login_attempts', {
  key: text().primaryKey(),
  attempts: integer().notNull(),
  windowStartedAt: ts().notNull(),
});

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: cascadeUser(),
    endpoint: text().notNull().unique(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const clientMutations = pgTable('client_mutations', {
  clientId: uuid().primaryKey(),
  userId: cascadeUser(),
  lastMutationId: bigint({ mode: 'number' }).notNull(),
  updatedAt: updatedAt(),
});

export const changes = pgTable(
  'changes',
  {
    seq: bigserial({ mode: 'number' }).primaryKey(),
    spaceId: uuid(),
    userId: uuid(),
    entity: text().notNull(),
    id: text().notNull(),
    op: text().notNull(),
    data: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.spaceId, t.seq),
    index().on(t.userId, t.seq),
    check('changes_op_check', inList(t.op, ['put', 'del'])),
  ],
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id(),
    userId: cascadeUser(),
    name: text().notNull(),
    tokenSha256: text().notNull().unique(),
    prefix: text().notNull(),
    scope: text().notNull(),
    expiresAt: ts(),
    lastUsedAt: ts(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId),
    check('api_tokens_scope_check', inList(t.scope, ['read', 'write'])),
  ],
);
