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
import type { EntityName, SyncBootstrap, SyncPull } from '@planar/shared';
import type { Db } from '../db/index.js';
import { activity, changes, clientMutations, spaceMembers, tasks } from '../db/schema.js';
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

  async bootstrap(userId: string, clientId: string): Promise<SyncBootstrap> {
    return this.snapshot(async (tx) => {
      const my = await this.mySpaces(tx, userId);
      const [{ max }] = await tx
        .select({ max: sql<string>`coalesce(max(${changes.seq}), 0)` })
        .from(changes);
      const data: SyncBootstrap['data'] = {};
      const hidden = await hiddenProjectIds(tx, userId);
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
      return {
        ...head,
        changes: rows.map((r) => ({
          seq: r.seq,
          entity: r.entity,
          id: r.id,
          op: r.op as 'put' | 'del',
          ...(r.op === 'put' ? { data: r.data as Record<string, unknown> } : {}),
        })),
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
        .select({ spaceId: tasks.spaceId })
        .from(tasks)
        .where(eq(tasks.id, taskId));
      const spaceId = task?.spaceId ?? rows[0]?.spaceId;
      if (!spaceId || !my.includes(spaceId)) throw new NotFoundException('задача не найдена');
      // PJ-11: the history of a task of a hidden project is hidden too
      if (task) {
        const [{ projectId }] = await tx
          .select({ projectId: tasks.projectId })
          .from(tasks)
          .where(eq(tasks.id, taskId));
        if (!(await projectAccess(tx, userId, projectId)))
          throw new NotFoundException('задача не найдена');
      }
      return { rows: rows.map((r) => toWire('activity', r)) };
    });
  }
}
