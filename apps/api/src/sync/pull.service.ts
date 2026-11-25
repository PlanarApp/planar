import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  SYNC_PROTOCOL,
  type EntityName,
  type SyncBootstrap,
  type SyncPull,
  type SyncTasksResponse,
} from '@planar/shared';
import type { Db } from '../db/index.js';
import {
  activity,
  changes,
  clientMutations,
  commentReactions,
  comments,
  notifications,
  spaceMembers,
  statuses,
  taskAssignees,
  tasks,
} from '../db/schema.js';
import { DB } from '../tokens.js';
import { hiddenProjectIds, notHidden, projectAccess } from './project-access.js';
import { visibleEntities } from './registry.js';
import { tableOf, toWire } from './rows.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const PULL_LIMIT = 5000;
const NOTIFICATIONS_LIMIT = 200;

@Injectable()
export class PullService {
  constructor(@Inject(DB) private db: Db) {}

  private snapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  private async mySpaces(tx: Tx, userId: string): Promise<string[]> {
    const rows = await tx
      .select({ id: spaceMembers.spaceId })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, userId));
    return rows.map((r) => r.id);
  }

  private async lastMutationId(tx: Tx, userId: string, clientId: string): Promise<number> {
    const [r] = await tx
      .select({ n: clientMutations.lastMutationId })
      .from(clientMutations)
      .where(and(eq(clientMutations.clientId, clientId), eq(clientMutations.userId, userId)));
    return r?.n ?? 0;
  }

  /**
   * C-sync v3: «my» tasks — visible to the user (space, PJ-11), assigned to them and not resolved
   * (status category not done/cancelled), plus the tasks of their notifications.
   */
  async myTasks(tx: Tx, userId: string, my: string[], hidden: string[]): Promise<string[]> {
    const visible = and(
      inArray(tasks.spaceId, my),
      hidden.length ? notInArray(tasks.projectId, hidden) : undefined,
    );
    const assigned = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
      .innerJoin(statuses, eq(statuses.id, tasks.statusId))
      .where(
        and(
          eq(taskAssignees.userId, userId),
          notInArray(statuses.category, ['done', 'cancelled']),
          visible,
        ),
      );
    const notified = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          inArray(
            tasks.id,
            tx
              .select({ id: notifications.taskId })
              .from(notifications)
              .where(eq(notifications.userId, userId)),
          ),
          visible,
        ),
      );
    return [...new Set([...assigned, ...notified].map((r) => r.id))];
  }

  /**
   * `protocol` — the client's C-sync version (header `X-Sync-Protocol`); from v3 the detail entities
   * carry only rows of «my» tasks and `held` lists these tasks; older — details in full, no `held` (v2).
   */
  async bootstrap(userId: string, clientId: string, protocol = 2): Promise<SyncBootstrap> {
    return this.snapshot(async (tx) => {
      const my = await this.mySpaces(tx, userId);
      const [{ max }] = await tx
        .select({ max: sql<string>`coalesce(max(${changes.seq}), 0)` })
        .from(changes);
      const data: SyncBootstrap['data'] = {};
      const hidden = await hiddenProjectIds(tx, userId);
      const held =
        protocol >= SYNC_PROTOCOL ? await this.myTasks(tx, userId, my, hidden) : undefined;
      for (const [name, meta] of Object.entries(await visibleEntities(tx))) {
        if (!meta.bootstrap) continue;
        const t = tableOf(name as EntityName);
        const c = getTableColumns(t);
        let where: SQL | undefined;
        if (meta.scope === 'space') where = inArray(name === 'spaces' ? c.id : c.spaceId, my);
        else if (meta.scope === 'user') where = eq(c.userId, userId);
        else if (meta.scope === 'space|user')
          where = or(eq(c.userId, userId), and(isNull(c.userId), inArray(c.spaceId, my)));
        else if (meta.scope === 'space|members' && meta.members) {
          const { entity, key, via } = meta.members;
          const mt = tableOf(entity as EntityName);
          const mc = getTableColumns(mt);
          const mine = inArray(
            c[via],
            tx.select({ k: mc[key] }).from(mt).where(eq(mc.userId, userId)),
          );
          where = c.spaceId ? or(inArray(c.spaceId, my), and(isNull(c.spaceId), mine)) : mine;
        }
        // C-sync v3: details only of «my» tasks
        if (held && meta.detail === 'tasks')
          where = and(
            where,
            c.taskId
              ? inArray(c.taskId, held)
              : inArray(
                  c.commentId,
                  tx
                    .select({ id: comments.id })
                    .from(comments)
                    .where(inArray(comments.taskId, held)),
                ),
          );
        // PJ-11: rows of projects hidden from the user are not delivered
        const q = tx
          .select()
          .from(t)
          .where(and(where, notHidden(name, hidden)));
        const rows = await (name === 'notifications'
          ? q.orderBy(desc(c.createdAt)).limit(NOTIFICATIONS_LIMIT)
          : q);
        data[name] = rows.map((r) => toWire(name as EntityName, r));
      }
      return {
        cursor: Number(max),
        lastMutationId: await this.lastMutationId(tx, userId, clientId),
        data,
        ...(held ? { held } : {}),
      };
    });
  }

  async pull(userId: string, clientId: string, cursor: number): Promise<SyncPull> {
    return this.snapshot(async (tx) => {
      const my = await this.mySpaces(tx, userId);
      const [{ max, min }] = await tx
        .select({
          max: sql<string>`coalesce(max(${changes.seq}), 0)`,
          min: sql<string | null>`min(${changes.seq})`,
        })
        .from(changes);
      const lastMutationId = await this.lastMutationId(tx, userId, clientId);
      const head = { cursor: Number(max), lastMutationId };
      const reset = { ...head, changes: [], reset: true };
      if (cursor > head.cursor || (min !== null && cursor < Number(min) - 1)) return reset;

      const visible = Object.keys(await visibleEntities(tx));
      const hidden = await hiddenProjectIds(tx, userId);
      const rows = await tx
        .select()
        .from(changes)
        .where(
          and(
            gt(changes.seq, cursor),
            hidden.length
              ? or(isNull(changes.projectId), notInArray(changes.projectId, hidden))
              : undefined,
            or(
              inArray(changes.spaceId, my),
              eq(changes.userId, userId),
              and(isNull(changes.spaceId), isNull(changes.userId)),
            ),
            inArray(changes.entity, [...visible, '_reset']),
          ),
        )
        .orderBy(asc(changes.seq))
        .limit(PULL_LIMIT + 1);
      if (rows.length > PULL_LIMIT || rows.some((r) => r.entity === '_reset')) return reset;
      // C-sync v3: a detail put carries its task — the client drops those of tasks it does not hold
      const data = (r: (typeof rows)[number]) => (r.data ?? {}) as Record<string, unknown>;
      const reacted = [
        ...new Set(
          rows
            .filter((r) => r.op === 'put' && r.entity === 'commentReactions')
            .map((r) => data(r).commentId as string),
        ),
      ];
      const ofComment = new Map(
        reacted.length
          ? (
              await tx
                .select({ id: comments.id, taskId: comments.taskId })
                .from(comments)
                .where(inArray(comments.id, reacted))
            ).map((c) => [c.id, c.taskId])
          : [],
      );
      const taskOf = (r: (typeof rows)[number]) =>
        r.op !== 'put'
          ? undefined
          : r.entity === 'comments'
            ? (data(r).taskId as string)
            : r.entity === 'commentReactions'
              ? ofComment.get(data(r).commentId as string)
              : undefined;
      return {
        ...head,
        changes: rows.map((r) => {
          const taskId = taskOf(r);
          return {
            seq: r.seq,
            entity: r.entity,
            id: r.id,
            op: r.op as 'put' | 'del',
            ...(r.op === 'put' ? { data: r.data as Record<string, unknown> } : {}),
            ...(taskId ? { taskId } : {}),
          };
        }),
      };
    });
  }

  /** Task history; the task (or its space) is invisible → 404. */
  async taskActivity(userId: string, taskId: string) {
    return this.snapshot(async (tx) => {
      const my = await this.mySpaces(tx, userId);
      const rows = await tx
        .select()
        .from(activity)
        .where(eq(activity.taskId, taskId))
        .orderBy(asc(activity.createdAt));
      const [task] = await tx
        .select({ spaceId: tasks.spaceId, projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, taskId));
      const spaceId = task?.spaceId ?? rows[0]?.spaceId;
      if (!spaceId || !my.includes(spaceId)) throw new NotFoundException('задача не найдена');
      // PJ-11: the history of a task of a hidden project is hidden too
      if (task) {
        if (!(await projectAccess(tx, userId, task.projectId)))
          throw new NotFoundException('задача не найдена');
      }
      return { rows: rows.map((r) => toWire('activity', r)) };
    });
  }

  /**
   * C-sync v3 `POST /sync/tasks`: snapshot of the details (comments, commentReactions) of the given tasks.
   * Visibility — as in taskActivity(): the task's space is the user's and its project is not hidden (PJ-11).
   */
  async taskDetails(userId: string, ids: string[]): Promise<SyncTasksResponse> {
    return this.snapshot(async (tx) => {
      const [{ max }] = await tx
        .select({ max: sql<string>`coalesce(max(${changes.seq}), 0)` })
        .from(changes);
      const my = new Set(await this.mySpaces(tx, userId));
      const hidden = new Set(await hiddenProjectIds(tx, userId));
      const found = await tx
        .select({ id: tasks.id, spaceId: tasks.spaceId, projectId: tasks.projectId })
        .from(tasks)
        .where(inArray(tasks.id, ids));
      const byId = new Map(found.map((t) => [t.id, t]));
      const ok = ids.filter((id) => {
        const t = byId.get(id);
        return t && my.has(t.spaceId) && !hidden.has(t.projectId);
      });
      const cs = ok.length
        ? await tx
            .select()
            .from(comments)
            .where(inArray(comments.taskId, ok))
            .orderBy(asc(comments.createdAt))
        : [];
      const rs = ok.length
        ? await tx
            .select({ r: commentReactions, taskId: comments.taskId })
            .from(commentReactions)
            .innerJoin(comments, eq(commentReactions.commentId, comments.id))
            .where(inArray(comments.taskId, ok))
            .orderBy(asc(commentReactions.createdAt))
        : [];
      const details = new Map(
        ok.map((id) => [
          id,
          {
            comments: [] as Record<string, unknown>[],
            commentReactions: [] as Record<string, unknown>[],
          },
        ]),
      );
      for (const c of cs) details.get(c.taskId)!.comments.push(toWire('comments', c));
      for (const { r, taskId } of rs)
        details.get(taskId)!.commentReactions.push(toWire('commentReactions', r));
      return {
        cursor: Number(max),
        tasks: ids.map((taskId) => {
          const d = details.get(taskId);
          if (d) return { taskId, status: 'ok' as const, ...d };
          return {
            taskId,
            status: byId.has(taskId) ? ('forbidden' as const) : ('not_found' as const),
          };
        }),
      };
    });
  }
}
