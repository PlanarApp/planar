import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import { textToDoc, uuidv7, type HttpErrorCode, type V1Task } from '@planar/shared';
import { HttpError } from '../auth/errors.js';
import type { Db } from '../db/index.js';
import * as s from '../db/schema.js';
import { PushQueue } from '../push/push.js';
import { executeMutations, Reject } from '../sync/mutate.js';
import { toWire } from '../sync/rows.js';
import { DB } from '../tokens.js';
import { commentBody, createTaskBody, listQuery, patchTaskBody, tasksQuery } from './schemas.js';

type Wire = Record<string, unknown>;
type Mut = { name: string; args: unknown };
const NOT_FOUND = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);

/** Разбор входа; ошибка → 400 invalid_request с issues. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Неверные параметры', r.error.issues);
  return r.data;
}

const HTTP: Record<string, [number, HttpErrorCode]> = {
  invalid_args: [400, 'invalid_request'],
  forbidden: [403, 'forbidden'],
  not_found: [404, 'not_found'],
  conflict: [409, 'conflict'],
};

const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function decode(c: string): { t: string; id: string } {
  try {
    const o = JSON.parse(Buffer.from(c, 'base64url').toString());
    if (typeof o.t === 'string' && z.uuid().safeParse(o.id).success && !isNaN(Date.parse(o.t)))
      return o;
  } catch {
    /* ниже */
  }
  throw new HttpError(400, 'invalid_request', 'Неверный cursor');
}

@Injectable()
export class RestService {
  constructor(
    @Inject(DB) private db: Db,
    @Optional() @Inject(PushQueue) private queue?: PushQueue,
  ) {}

  private async mySpaces(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: s.spaceMembers.spaceId })
      .from(s.spaceMembers)
      .where(eq(s.spaceMembers.userId, userId));
    return rows.map((r) => r.id);
  }

  /**
   * Страница по (ts, id) с курсором. Курсор несёт сырой timestamptz из БД (микросекунды),
   * поэтому сравнение строкой в БД, а не в JS.
   */
  private async page(
    table: PgTable,
    where: (SQL | undefined)[],
    q: z.output<typeof listQuery>,
    tsKey: 'updatedAt' | 'createdAt',
    dir: 'asc' | 'desc',
  ) {
    const c = getTableColumns(table);
    const conds = [...where];
    if (q.cursor) {
      const cur = decode(q.cursor);
      const op = dir === 'desc' ? sql`<` : sql`>`;
      conds.push(sql`(${c[tsKey]}, ${c.id}) ${op} (${cur.t}::timestamptz, ${cur.id}::uuid)`);
    }
    const ord = dir === 'desc' ? desc : asc;
    const rows = (await this.db
      .select()
      .from(table)
      .where(and(...conds))
      .orderBy(ord(c[tsKey]), ord(c.id))
      .limit(q.limit + 1)) as Wire[];
    const more = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: more && last ? encode({ t: last[tsKey], id: last.id }) : null,
    };
  }

  async spaces(userId: string, query: unknown) {
    const q = parse(listQuery, query);
    const my = await this.mySpaces(userId);
    const p = await this.page(s.spaces, [inArray(s.spaces.id, my)], q, 'updatedAt', 'desc');
    return { data: p.items.map((r) => toWire('spaces', r)), nextCursor: p.nextCursor };
  }

  async projects(userId: string, query: unknown) {
    const q = parse(listQuery.extend({ spaceId: z.uuid().optional() }), query);
    const my = await this.mySpaces(userId);
    if (q.spaceId && !my.includes(q.spaceId)) throw NOT_FOUND('Пространство');
    const where = [inArray(s.projects.spaceId, q.spaceId ? [q.spaceId] : my)];
    const p = await this.page(s.projects, where, q, 'updatedAt', 'desc');
    return { data: p.items.map((r) => toWire('projects', r)), nextCursor: p.nextCursor };
  }

  async tasks(userId: string, query: unknown) {
    const q = parse(tasksQuery, query);
    const my = await this.mySpaces(userId);
    const where: (SQL | undefined)[] = [
      inArray(s.tasks.spaceId, my),
      q.projectId ? eq(s.tasks.projectId, q.projectId) : undefined,
      q.statusId ? eq(s.tasks.statusId, q.statusId) : undefined,
      q.updatedAfter ? sql`${s.tasks.updatedAt} > ${q.updatedAfter}::timestamptz` : undefined,
    ];
    if (q.assigneeId) {
      const who = q.assigneeId === 'me' ? userId : q.assigneeId;
      where.push(
        sql`exists (select 1 from ${s.taskAssignees} a where a.task_id = ${s.tasks.id} and a.user_id = ${who})`,
      );
    }
    const p = await this.page(s.tasks, where, q, 'updatedAt', 'desc');
    return { data: await this.enrich(p.items), nextCursor: p.nextCursor };
  }

  /** MCP search_tasks / my_tasks: поиск по title и ключу без учёта регистра */
  async searchTasks(
    userId: string,
    q: {
      query?: string;
      projectId?: string;
      statusId?: string;
      assigneeId?: string;
      includeDone?: boolean;
      limit?: number;
    },
  ) {
    const my = await this.mySpaces(userId);
    const like = q.query ? `%${q.query.replace(/[\\%_]/g, '\\$&')}%` : null;
    const who = q.assigneeId === 'me' ? userId : q.assigneeId;
    const where: (SQL | undefined)[] = [
      inArray(s.tasks.spaceId, my),
      q.projectId ? eq(s.tasks.projectId, q.projectId) : undefined,
      q.statusId ? eq(s.tasks.statusId, q.statusId) : undefined,
      who
        ? sql`exists (select 1 from ${s.taskAssignees} a where a.task_id = ${s.tasks.id} and a.user_id = ${who})`
        : undefined,
      q.includeDone === false
        ? sql`not exists (select 1 from ${s.statuses} st where st.id = ${s.tasks.statusId} and st.category in ('done','cancelled'))`
        : undefined,
      like
        ? sql`(${s.tasks.title} ilike ${like} or (select p.key || '-' || ${s.tasks.number} from ${s.projects} p where p.id = ${s.tasks.projectId}) ilike ${like})`
        : undefined,
    ];
    const p = await this.page(s.tasks, where, { limit: q.limit ?? 20 }, 'updatedAt', 'desc');
    return this.enrich(p.items);
  }

  /** строки tasks → V1Task (key, assigneeIds, labelIds) */
  private async enrich(rows: Wire[]): Promise<V1Task[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id as string);
    const projects = await this.db
      .select({ id: s.projects.id, key: s.projects.key })
      .from(s.projects)
      .where(inArray(s.projects.id, [...new Set(rows.map((r) => r.projectId as string))]));
    const as = await this.db
      .select({ t: s.taskAssignees.taskId, u: s.taskAssignees.userId })
      .from(s.taskAssignees)
      .where(inArray(s.taskAssignees.taskId, ids))
      .orderBy(asc(s.taskAssignees.createdAt), asc(s.taskAssignees.id));
    const ls = await this.db
      .select({ t: s.taskLabels.taskId, l: s.taskLabels.labelId })
      .from(s.taskLabels)
      .where(inArray(s.taskLabels.taskId, ids))
      .orderBy(asc(s.taskLabels.createdAt), asc(s.taskLabels.id));
    const key = new Map(projects.map((p) => [p.id, p.key]));
    return rows.map((r) => {
      const n = r.number as number | null;
      return {
        ...toWire('tasks', r),
        key: n == null ? null : `${key.get(r.projectId as string)}-${n}`,
        assigneeIds: as.filter((x) => x.t === r.id).map((x) => x.u),
        labelIds: ls.filter((x) => x.t === r.id).map((x) => x.l),
      } as V1Task;
    });
  }

  /** :task — uuid или ключ ABC-123; невидимая → 404. Возвращает строку БД. */
  private async findTask(userId: string, ref: string): Promise<Wire> {
    const my = await this.mySpaces(userId);
    let cond: SQL;
    const i = ref.lastIndexOf('-');
    if (z.uuid().safeParse(ref).success) cond = eq(s.tasks.id, ref);
    else if (i > 0 && /^\d+$/.test(ref.slice(i + 1)) && Number(ref.slice(i + 1)) < 2 ** 31)
      cond = sql`${s.tasks.number} = ${Number(ref.slice(i + 1))} and ${s.tasks.projectId} = (select id from ${s.projects} where ${s.projects.key} = ${ref.slice(0, i)})`;
    else throw NOT_FOUND('Задача');
    const [row] = await this.db
      .select()
      .from(s.tasks)
      .where(and(cond, inArray(s.tasks.spaceId, my)));
    if (!row) throw NOT_FOUND('Задача');
    return row;
  }

  async task(userId: string, ref: string) {
    return { data: (await this.enrich([await this.findTask(userId, ref)]))[0] };
  }

  /** @login в тексте → известные пользователи для textToDoc */
  private async toDoc(text: string) {
    const logins = [...text.matchAll(/@([\w.-]+)/g)].map((m) => m[1]);
    const users = logins.length
      ? await this.db
          .select({ id: s.users.id, login: s.users.login })
          .from(s.users)
          .where(inArray(s.users.login, logins))
      : [];
    return textToDoc(text, users);
  }

  private async run(userId: string, muts: Mut[], tokenId?: string) {
    try {
      await executeMutations(this.db, userId, muts, this.queue, tokenId);
    } catch (err) {
      if (!(err instanceof Reject)) throw err;
      const [status, code] = HTTP[err.code] ?? [500, 'internal'];
      throw new HttpError(status, code, status === 500 ? 'Внутренняя ошибка' : err.message);
    }
  }

  async createTask(userId: string, raw: unknown, tokenId?: string) {
    const b = parse(createTaskBody, raw);
    const my = await this.mySpaces(userId);
    const [project] = await this.db
      .select({ spaceId: s.projects.spaceId })
      .from(s.projects)
      .where(and(eq(s.projects.id, b.projectId), inArray(s.projects.spaceId, my)));
    if (!project) throw NOT_FOUND('Проект');
    let statusId = b.statusId;
    if (!statusId) {
      const sts = await this.db
        .select({ id: s.statuses.id, category: s.statuses.category })
        .from(s.statuses)
        .where(eq(s.statuses.spaceId, project.spaceId))
        .orderBy(asc(s.statuses.rank));
      statusId = (
        sts.find((x) => x.category === 'todo') ?? sts.find((x) => x.category === 'backlog')
      )?.id;
      if (!statusId) throw new HttpError(400, 'invalid_request', 'нет статуса по умолчанию');
    }
    const [last] = await this.db
      .select({ rank: s.tasks.rank })
      .from(s.tasks)
      .where(eq(s.tasks.statusId, statusId))
      .orderBy(desc(s.tasks.rank))
      .limit(1);
    const id = uuidv7();
    await this.run(
      userId,
      [
        {
          name: 'task.create',
          args: {
            id,
            projectId: b.projectId,
            statusId,
            title: b.title,
            rank: generateKeyBetween(last?.rank ?? null, null),
            parentId: b.parentId,
            description: b.description === undefined ? undefined : await this.toDoc(b.description),
            priority: b.priority,
            dueDate: b.dueDate,
            assignees: b.assigneeIds?.map((u) => ({ id: uuidv7(), userId: u })),
            labels: b.labelIds?.map((l) => ({ id: uuidv7(), labelId: l })),
          },
        },
      ],
      tokenId,
    );
    return this.task(userId, id);
  }

  async patchTask(userId: string, ref: string, raw: unknown, tokenId?: string) {
    const b = parse(patchTaskBody, raw);
    const t = await this.findTask(userId, ref);
    const id = t.id as string;
    const { assigneeIds, labelIds, description, ...scalar } = b;
    const muts: Mut[] = [];
    const upd = {
      ...scalar,
      description: description == null ? description : await this.toDoc(description),
    };
    if (Object.values(upd).some((v) => v !== undefined))
      muts.push({ name: 'task.update', args: { id, ...upd } });
    if (assigneeIds) {
      const cur = (await this.enrich([t]))[0]!;
      const want = new Set(assigneeIds);
      for (const u of cur.assigneeIds)
        if (!want.has(u)) muts.push({ name: 'task.unassign', args: { taskId: id, userId: u } });
      for (const u of want)
        if (!cur.assigneeIds.includes(u))
          muts.push({ name: 'task.assign', args: { id: uuidv7(), taskId: id, userId: u } });
    }
    if (labelIds) {
      const cur = (await this.enrich([t]))[0]!;
      const want = new Set(labelIds);
      for (const l of cur.labelIds)
        if (!want.has(l)) muts.push({ name: 'task.removeLabel', args: { taskId: id, labelId: l } });
      for (const l of want)
        if (!cur.labelIds.includes(l))
          muts.push({ name: 'task.addLabel', args: { id: uuidv7(), taskId: id, labelId: l } });
    }
    await this.run(userId, muts, tokenId);
    return this.task(userId, id);
  }

  async comments(userId: string, ref: string, query: unknown) {
    const q = parse(listQuery, query);
    const t = await this.findTask(userId, ref);
    const p = await this.page(
      s.comments,
      [eq(s.comments.taskId, t.id as string)],
      q,
      'createdAt',
      'asc',
    );
    return { data: p.items.map((r) => toWire('comments', r)), nextCursor: p.nextCursor };
  }

  async createComment(userId: string, ref: string, raw: unknown, tokenId?: string) {
    const b = parse(commentBody, raw);
    const t = await this.findTask(userId, ref);
    const id = uuidv7();
    await this.run(
      userId,
      [{ name: 'comment.create', args: { id, taskId: t.id, body: await this.toDoc(b.text) } }],
      tokenId,
    );
    const [row] = await this.db.select().from(s.comments).where(eq(s.comments.id, id));
    return { data: toWire('comments', row!) };
  }
}
