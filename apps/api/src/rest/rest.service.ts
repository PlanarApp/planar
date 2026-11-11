import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import { docToMarkdown, markdownToDoc } from '@planar/editor/markdown';
import { textToDoc, uuidv7, type HttpErrorCode, type V1Task } from '@planar/shared';
import { HttpError } from '../auth/errors.js';
import type { Db } from '../db/index.js';
import * as s from '../db/schema.js';
import { enabledModules, moduleOnInProject } from '../modules/enabled.js';
import { moduleTables } from '../modules/installed.js';
import { PushQueue } from '../push/push.js';
import { executeMutations, Reject } from '../sync/mutate.js';
import { hiddenProjectIds, notHidden, projectAccess } from '../sync/project-access.js';
import { DB } from '../tokens.js';
import { toWire } from '../sync/rows.js';
import { toV1Tasks } from './v1-tasks.js';
import {
  commentBody,
  createDocBody,
  createTaskBody,
  docQuery,
  docsQuery,
  docTaskBody,
  linkBody,
  listQuery,
  patchDocBody,
  patchTaskBody,
  tasksQuery,
  timeEntriesQuery,
  timeLogBody,
  timerStartBody,
} from './schemas.js';

/**
 * "Assignee = who": a task assignee; for the caller themselves also a task with an open
 * comment or checklist item assigned to them (PLNRAPP-140, as «mine» in the web app).
 */
const assignedTo = (who: string, userId: string) => {
  const task = sql`exists (select 1 from ${s.taskAssignees} a where a.task_id = ${s.tasks.id} and a.user_id = ${who})`;
  if (who !== userId) return task;
  return or(
    task,
    sql`exists (select 1 from ${s.comments} c where c.task_id = ${s.tasks.id} and c.assignee_id = ${who} and c.resolved_at is null)`,
    sql`exists (select 1 from ${s.checklistItems} i where i.task_id = ${s.tasks.id} and i.assignee_id = ${who} and not i.done)`,
  );
};

type Wire = Record<string, unknown>;
type Mut = { name: string; args: unknown };
const NOT_FOUND = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);

/** Input parsing; error → 400 invalid_request with issues. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Неверные параметры', r.error.issues);
  return r.data;
}

/** C-schema v16: entries of projects where the time module is on. */
const timeOn = (c: Record<string, PgColumn>) =>
  sql`exists (select 1 from tasks tk join projects pj on pj.id = tk.project_id
    where tk.id = ${c.taskId!} and 'time' = any(pj.modules))`;

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
    /* below */
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

  /** PJ-11: where-condition — the entity's rows outside projects hidden from the user. */
  private async visible(userId: string, entity: string): Promise<SQL | undefined> {
    return notHidden(entity, await hiddenProjectIds(this.db, userId));
  }

  /** PJ-11: no access to the project → 404 as for a nonexistent one. */
  private async requireProject(userId: string, projectId: string, what = 'Проект') {
    if (!(await projectAccess(this.db, userId, projectId))) throw NOT_FOUND(what);
  }

  /**
   * Page by (ts, id) with a cursor. The cursor carries the raw timestamptz from the DB (microseconds),
   * so the comparison is done as a string in the DB, not in JS.
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
    const where = [
      inArray(s.projects.spaceId, q.spaceId ? [q.spaceId] : my),
      await this.visible(userId, 'projects'),
    ];
    const p = await this.page(s.projects, where, q, 'updatedAt', 'desc');
    return { data: p.items.map((r) => toWire('projects', r)), nextCursor: p.nextCursor };
  }

  async fields(userId: string, projectId: string) {
    const my = await this.mySpaces(userId);
    if (!z.uuid().safeParse(projectId).success) throw NOT_FOUND('Проект');
    const [project] = await this.db
      .select({ id: s.projects.id })
      .from(s.projects)
      .where(and(eq(s.projects.id, projectId), inArray(s.projects.spaceId, my)));
    if (!project) throw NOT_FOUND('Проект');
    await this.requireProject(userId, projectId);
    const rows = (await this.db
      .select()
      .from(s.fieldDefs)
      .where(eq(s.fieldDefs.projectId, projectId))
      .orderBy(asc(s.fieldDefs.rank), asc(s.fieldDefs.id))) as Wire[];
    return { data: rows.map((r) => toWire('fieldDefs', r)) };
  }

  /** MCP project_dictionary: what statusId / labelIds / assigneeIds of the project's tasks mean */
  async dictionary(userId: string, projectId: string) {
    await this.fields(userId, projectId); // the same 404 for a foreign or hidden project
    const [statuses, labels, members] = await Promise.all([
      this.db
        .select({ id: s.statuses.id, name: s.statuses.name, category: s.statuses.category })
        .from(s.statuses)
        .where(eq(s.statuses.projectId, projectId))
        .orderBy(asc(s.statuses.rank)),
      this.db
        .select({ id: s.labels.id, name: s.labels.name })
        .from(s.labels)
        .where(eq(s.labels.projectId, projectId))
        .orderBy(asc(s.labels.name)),
      // members with access to the project (custom projects narrow the space)
      this.db
        .select({ id: s.users.id, name: s.users.name, login: s.users.login })
        .from(s.users)
        .innerJoin(s.spaceMembers, eq(s.spaceMembers.userId, s.users.id))
        .where(
          and(
            sql`${s.spaceMembers.spaceId} = (select space_id from projects where id = ${projectId})`,
            isNull(s.users.deactivatedAt),
            sql`project_role(${s.users.id}, ${projectId}::uuid) is not null`,
          ),
        )
        .orderBy(asc(s.users.name)),
    ]);
    return { statuses, labels, members };
  }

  /** status name and category by id (MCP adds them to tasks: an id alone tells an agent nothing) */
  async statusInfo(ids: string[]): Promise<Map<string, { name: string; category: string }>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: s.statuses.id, name: s.statuses.name, category: s.statuses.category })
      .from(s.statuses)
      .where(inArray(s.statuses.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, { name: r.name, category: r.category }]));
  }

  async tasks(userId: string, query: unknown) {
    const q = parse(tasksQuery, query);
    const my = await this.mySpaces(userId);
    const where: (SQL | undefined)[] = [
      inArray(s.tasks.spaceId, my),
      await this.visible(userId, 'tasks'),
      isNull(s.tasks.archivedAt), // PLNRAPP-155: the archive is seen in the project's settings only
      q.projectId ? eq(s.tasks.projectId, q.projectId) : undefined,
      q.statusId ? eq(s.tasks.statusId, q.statusId) : undefined,
      q.updatedAfter ? sql`${s.tasks.updatedAt} > ${q.updatedAfter}::timestamptz` : undefined,
    ];
    if (q.assigneeId) where.push(assignedTo(q.assigneeId === 'me' ? userId : q.assigneeId, userId));
    const p = await this.page(s.tasks, where, q, 'updatedAt', 'desc');
    return { data: await this.enrich(p.items), nextCursor: p.nextCursor };
  }

  /** MCP search_tasks / my_tasks: case-insensitive search by title and key */
  async searchTasks(
    userId: string,
    q: {
      query?: string;
      projectId?: string;
      statusId?: string;
      assigneeId?: string;
      includeDone?: boolean;
      statusCategory?: string;
      limit?: number;
    },
  ) {
    const my = await this.mySpaces(userId);
    const like = q.query ? `%${q.query.replace(/[\\%_]/g, '\\$&')}%` : null;
    const who = q.assigneeId === 'me' ? userId : q.assigneeId;
    const where: (SQL | undefined)[] = [
      inArray(s.tasks.spaceId, my),
      await this.visible(userId, 'tasks'),
      isNull(s.tasks.archivedAt),
      q.projectId ? eq(s.tasks.projectId, q.projectId) : undefined,
      q.statusId ? eq(s.tasks.statusId, q.statusId) : undefined,
      who ? assignedTo(who, userId) : undefined,
      q.includeDone === false
        ? sql`not exists (select 1 from ${s.statuses} st where st.id = ${s.tasks.statusId} and st.category in ('done','cancelled'))`
        : undefined,
      q.statusCategory
        ? sql`exists (select 1 from ${s.statuses} st where st.id = ${s.tasks.statusId} and st.category = ${q.statusCategory})`
        : undefined,
      like
        ? sql`(${s.tasks.title} ilike ${like} or (select p.key || '-' || ${s.tasks.number} from ${s.projects} p where p.id = ${s.tasks.projectId}) ilike ${like})`
        : undefined,
    ];
    const p = await this.page(s.tasks, where, { limit: q.limit ?? 20 }, 'updatedAt', 'desc');
    return this.enrich(p.items);
  }

  /** tasks rows → V1Task (key, assigneeIds, labelIds) */
  private enrich(rows: Wire[]): Promise<V1Task[]> {
    return toV1Tasks(this.db, rows);
  }

  /** :task — uuid or key ABC-123; invisible → 404. Returns the DB row. */
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
    await this.requireProject(userId, row.projectId, 'Задача');
    return row;
  }

  async task(userId: string, ref: string) {
    return { data: (await this.enrich([await this.findTask(userId, ref)]))[0] };
  }

  /** @login in text → known users for textToDoc */
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
    await this.requireProject(userId, b.projectId);
    let statusId = b.statusId;
    if (!statusId) {
      const sts = await this.db
        .select({ id: s.statuses.id, category: s.statuses.category })
        .from(s.statuses)
        .where(eq(s.statuses.projectId, b.projectId))
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
    const { assigneeIds, labelIds, description, fields, ...scalar } = b;
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
    for (const [fieldId, value] of Object.entries(fields ?? {}))
      muts.push({ name: 'task.setField', args: { taskId: id, fieldId, value: value ?? null } });
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

  private async visibleProject(userId: string, id: string) {
    const [p] = z.uuid().safeParse(id).success
      ? await this.db
          .select({ id: s.projects.id })
          .from(s.projects)
          .where(
            and(eq(s.projects.id, id), inArray(s.projects.spaceId, await this.mySpaces(userId))),
          )
      : [];
    if (!p) throw NOT_FOUND('Проект');
    await this.requireProject(userId, p.id);
    return p.id;
  }

  // --- task links (core) ---

  async links(userId: string, ref: string) {
    const t = await this.findTask(userId, ref);
    const rows = (await this.db
      .select()
      .from(s.taskLinks)
      .where(or(eq(s.taskLinks.taskId, t.id as string), eq(s.taskLinks.targetId, t.id as string)))
      .orderBy(asc(s.taskLinks.createdAt), asc(s.taskLinks.id))) as Wire[];
    return { data: rows.map((r) => toWire('taskLinks', r)) };
  }

  async createLink(userId: string, ref: string, raw: unknown, tokenId?: string) {
    const b = parse(linkBody, raw);
    const t = await this.findTask(userId, ref);
    const o = await this.findTask(userId, b.target);
    const id = uuidv7();
    await this.run(
      userId,
      [{ name: 'link.create', args: { id, taskId: t.id, targetId: o.id, kind: b.kind } }],
      tokenId,
    );
    const [row] = await this.db.select().from(s.taskLinks).where(eq(s.taskLinks.id, id));
    return { data: toWire('taskLinks', row!) };
  }

  async deleteLink(userId: string, id: string, tokenId?: string) {
    const [row] = z.uuid().safeParse(id).success
      ? await this.db
          .select({ id: s.taskLinks.id })
          .from(s.taskLinks)
          .where(
            and(
              eq(s.taskLinks.id, id),
              inArray(s.taskLinks.spaceId, await this.mySpaces(userId)),
              await this.visible(userId, 'taskLinks'),
            ),
          )
      : [];
    if (!row) throw NOT_FOUND('Связь');
    await this.run(userId, [{ name: 'link.delete', args: { id } }], tokenId);
  }

  // --- time (time module) ---

  /** Module table and its columns (the core does not know module types). */
  private async mod(moduleId: string, entity: string, projectId?: string) {
    const t = moduleTables().get(entity);
    if (
      !t ||
      !(await enabledModules(this.db)).has(moduleId) ||
      // C-schema v16: a route addressed to a project — the data module must be on there
      (projectId && !(await moduleOnInProject(this.db, moduleId, projectId)))
    )
      throw new HttpError(404, 'module_disabled', `Модуль ${moduleId} выключен`);
    return { t, c: getTableColumns(t) as Record<string, PgColumn> };
  }

  private async entry(id: string) {
    const { t, c } = await this.mod('time', 'timeEntries');
    const [row] = await this.db.select().from(t).where(eq(c.id!, id));
    return toWire('timeEntries', row as Wire);
  }

  /** the user's running timer, or null */
  private async running(userId: string) {
    const { t, c } = await this.mod('time', 'timeEntries');
    const [row] = await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(c.userId!, userId),
          isNull(c.endedAt!),
          timeOn(c),
          await this.visible(userId, 'timeEntries'),
        ),
      );
    return row ? toWire('timeEntries', row as Wire) : null;
  }

  async timeEntries(userId: string, query: unknown) {
    const q = parse(timeEntriesQuery, query);
    const { t, c } = await this.mod('time', 'timeEntries');
    const where: (SQL | undefined)[] = [
      inArray(c.spaceId!, await this.mySpaces(userId)),
      timeOn(c),
      await this.visible(userId, 'timeEntries'),
      q.taskId ? eq(c.taskId!, q.taskId) : undefined,
      q.userId ? eq(c.userId!, q.userId === 'me' ? userId : q.userId) : undefined,
      q.from ? sql`${c.startedAt!} >= ${q.from}::timestamptz` : undefined,
      q.to ? sql`${c.startedAt!} <= ${q.to}::timestamptz` : undefined,
    ];
    const p = await this.page(t, where, q, 'updatedAt', 'desc');
    return { data: p.items.map((r) => toWire('timeEntries', r)), nextCursor: p.nextCursor };
  }

  async logTime(userId: string, raw: unknown, tokenId?: string) {
    const b = parse(timeLogBody, raw);
    const t = await this.findTask(userId, b.task);
    await this.mod('time', 'timeEntries', t.projectId as string);
    const id = uuidv7();
    await this.run(
      userId,
      [
        {
          name: 'time.log',
          args: {
            id,
            taskId: t.id,
            startedAt: b.startedAt,
            durationSec: b.durationSec,
            note: b.note,
          },
        },
      ],
      tokenId,
    );
    return { data: await this.entry(id) };
  }

  async timer(userId: string) {
    return { data: await this.running(userId) };
  }

  async startTimer(userId: string, raw: unknown, tokenId?: string) {
    const b = parse(timerStartBody, raw);
    const t = await this.findTask(userId, b.task);
    await this.mod('time', 'timeEntries', t.projectId as string);
    const id = uuidv7();
    await this.run(userId, [{ name: 'time.start', args: { id, taskId: t.id } }], tokenId);
    return { data: await this.entry(id) };
  }

  async stopTimer(userId: string, tokenId?: string) {
    const cur = await this.running(userId);
    if (!cur) return { data: null };
    await this.run(userId, [{ name: 'time.stop', args: { id: cur.id } }], tokenId);
    return { data: await this.entry(cur.id as string) };
  }

  // --- cycles (sprints module) ---

  async cycles(userId: string, projectId: string) {
    const pid = await this.visibleProject(userId, projectId);
    const { t, c } = await this.mod('sprints', 'sprintsCycles', pid);
    const rows = await this.db
      .select()
      .from(t)
      .where(eq(c.projectId!, pid))
      .orderBy(desc(c.number!));
    return { data: (rows as Wire[]).map((r) => toWire('sprintsCycles', r)) };
  }

  /** current: not closed, startDate ≤ today ≤ endDate; "today" is in the project time zone (UTC without settings) */
  async currentCycle(userId: string, projectId: string) {
    const pid = await this.visibleProject(userId, projectId);
    const { t, c } = await this.mod('sprints', 'sprintsCycles', pid);
    const st = await this.mod('sprints', 'sprintsSettings');
    const [cfg] = (await this.db.select().from(st.t).where(eq(st.c.projectId!, pid))) as Wire[];
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: (cfg?.timezone as string | undefined) ?? 'UTC',
    });
    const [row] = await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(c.projectId!, pid),
          isNull(c.closedAt!),
          sql`${c.startDate!} <= ${today}::date and ${c.endDate!} >= ${today}::date`,
        ),
      );
    return { data: row ? toWire('sprintsCycles', row as Wire) : null };
  }

  /** MCP current_sprint: tasks of the cycle (up to 200) */
  async cycleTasks(userId: string, cycleId: string) {
    const rows = (await this.db
      .select()
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.cycleId, cycleId),
          inArray(s.tasks.spaceId, await this.mySpaces(userId)),
          await this.visible(userId, 'tasks'),
          sql`exists (select 1 from projects pj where pj.id = ${s.tasks.projectId} and 'sprints' = any(pj.modules))`,
        ),
      )
      .orderBy(asc(s.tasks.rank), asc(s.tasks.id))
      .limit(200)) as Wire[];
    return this.enrich(rows);
  }

  // --- documents (docs module, PLNRAPP-180): content in and out — markdown ---

  /** page without body/text/files: the list and the head of get */
  private docMeta(row: Wire) {
    const meta = toWire('docsPages', row);
    delete meta.body;
    delete meta.text;
    delete meta.files;
    return meta;
  }

  /** a live page of the user's space; a project page — project access and docs on in it */
  private async findDoc(userId: string, id: string): Promise<Wire> {
    const { t, c } = await this.mod('docs', 'docsPages');
    const [row] = z.uuid().safeParse(id).success
      ? ((await this.db
          .select()
          .from(t)
          .where(
            and(
              eq(c.id!, id),
              inArray(c.spaceId!, await this.mySpaces(userId)),
              isNull(c.archivedAt!),
            ),
          )) as Wire[])
      : [];
    if (!row) throw NOT_FOUND('Документ');
    if (row.projectId) {
      await this.requireProject(userId, row.projectId as string, 'Документ');
      await this.mod('docs', 'docsPages', row.projectId as string);
    }
    return row;
  }

  async docs(userId: string, query: unknown) {
    const q = parse(docsQuery, query);
    const pid = await this.visibleProject(userId, q.projectId);
    const { t, c } = await this.mod('docs', 'docsPages', pid);
    const rows = (await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(c.projectId!, pid),
          isNull(c.archivedAt!),
          q.parentId ? eq(c.parentId!, q.parentId) : undefined,
        ),
      )
      .orderBy(asc(c.rank!), asc(c.id!))) as Wire[];
    return { data: rows.map((r) => this.docMeta(r)) };
  }

  async doc(userId: string, id: string, query: unknown = {}) {
    const q = parse(docQuery, query);
    const row = await this.findDoc(userId, id);
    let markdown = docToMarkdown(row.body as JSONContent);
    if (q.section !== undefined) {
      const hs = headings(markdown);
      const k = hs.findIndex((h) => h.text === q.section!.trim());
      if (k < 0)
        throw new HttpError(
          404,
          'not_found',
          `Раздел «${q.section}» не найден; заголовки: ${hs.map((h) => h.text).join(' | ')}`,
        );
      const lines = markdown.split('\n');
      const end = hs.slice(k + 1).find((h) => h.level <= hs[k]!.level)?.i ?? lines.length;
      markdown = lines.slice(hs[k]!.i, end).join('\n').trimEnd();
    }
    const l = await this.mod('docs', 'docsTaskLinks');
    const linked = (await this.db
      .select({ taskId: l.c.taskId! })
      .from(l.t)
      .where(eq(l.c.pageId!, row.id as string))) as { taskId: string }[];
    const tasks = linked.length
      ? await this.enrich(
          await this.db
            .select()
            .from(s.tasks)
            .where(
              and(
                inArray(
                  s.tasks.id,
                  linked.map((x) => x.taskId),
                ),
                await this.visible(userId, 'tasks'),
              ),
            ),
        )
      : [];
    return {
      data: {
        ...this.docMeta(row),
        markdown,
        tasks: tasks.map((x) => ({ id: x.id, key: x.key, title: x.title })),
      },
    };
  }

  async createDoc(userId: string, raw: unknown, tokenId?: string) {
    const b = parse(createDocBody, raw);
    const pid = await this.visibleProject(userId, b.projectId);
    const { t, c } = await this.mod('docs', 'docsPages', pid);
    if (b.parentId && (await this.findDoc(userId, b.parentId)).projectId !== pid)
      throw new HttpError(400, 'invalid_request', 'Родитель — документ другого проекта');
    const [project] = await this.db
      .select({ spaceId: s.projects.spaceId })
      .from(s.projects)
      .where(eq(s.projects.id, pid));
    const [last] = (await this.db
      .select({ rank: c.rank! })
      .from(t)
      .where(
        and(eq(c.projectId!, pid), b.parentId ? eq(c.parentId!, b.parentId) : isNull(c.parentId!)),
      )
      .orderBy(desc(c.rank!))
      .limit(1)) as { rank: string }[];
    const id = uuidv7();
    await this.run(
      userId,
      [
        {
          name: 'docs.page.create',
          args: {
            id,
            spaceId: project!.spaceId,
            projectId: pid,
            parentId: b.parentId ?? null,
            rank: generateKeyBetween(last?.rank ?? null, null),
            title: b.title,
            body: b.markdown === undefined ? undefined : markdownToDoc(b.markdown),
          },
        },
      ],
      tokenId,
    );
    return this.doc(userId, id);
  }

  async updateDoc(userId: string, id: string, raw: unknown, tokenId?: string) {
    const b = parse(patchDocBody, raw);
    if ([b.markdown, b.append, b.replace].filter((x) => x !== undefined).length > 1)
      throw new HttpError(400, 'invalid_request', 'Одно из markdown, append, replace');
    const row = await this.findDoc(userId, id);
    const old = (row.body as JSONContent).content ?? [];
    let body: JSONContent | undefined;
    if (b.markdown !== undefined) body = markdownToDoc(b.markdown);
    else if (b.append !== undefined)
      body = { type: 'doc', content: [...old, ...markdownToDoc(b.append).content] };
    else if (b.replace) {
      const parts = docToMarkdown(row.body as JSONContent).split(b.replace.find);
      if (parts.length !== 2)
        throw new HttpError(
          400,
          'invalid_request',
          parts.length < 2
            ? 'Фрагмент replace.find не найден'
            : `Фрагмент replace.find найден ${parts.length - 1} раз — уточните его`,
        );
      body = markdownToDoc(parts[0] + b.replace.replace + parts[1]);
    }
    if (b.title !== undefined || body)
      await this.run(
        userId,
        [{ name: 'docs.page.update', args: { id: row.id, title: b.title, body } }],
        tokenId,
      );
    return this.doc(userId, row.id as string);
  }

  async linkDocTask(userId: string, id: string, raw: unknown, tokenId?: string) {
    const b = parse(docTaskBody, raw);
    const row = await this.findDoc(userId, id);
    const task = await this.findTask(userId, b.task);
    await this.run(
      userId,
      [{ name: 'docs.link.add', args: { id: uuidv7(), pageId: row.id, taskId: task.id } }],
      tokenId,
    );
    return this.doc(userId, row.id as string);
  }

  // --- automations (automations module, read) ---

  async automations(userId: string, projectId: string) {
    const pid = await this.visibleProject(userId, projectId);
    const { t, c } = await this.mod('automations', 'automationsRules', pid);
    const rows = await this.db
      .select()
      .from(t)
      .where(eq(c.projectId!, pid))
      .orderBy(asc(c.createdAt!), asc(c.id!));
    return { data: (rows as Wire[]).map((r) => toWire('automationsRules', r)) };
  }
}

/** ATX headings of markdown outside code fences: line index, level, text. */
export function headings(md: string) {
  let fence = false;
  return md.split('\n').flatMap((l, i) => {
    if (/^ {0,3}(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && /^ {0,3}(#{1,6}) +(.+?)(?: +#+)? *$/.exec(l);
    return h ? [{ i, level: h[1]!.length, text: h[2]! }] : [];
  });
}
