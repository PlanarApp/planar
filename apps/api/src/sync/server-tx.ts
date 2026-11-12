import { and, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { MutatorError, uuidv7, type EntityName, type Row, type Tx } from '@planar/shared';
import * as schema from '../db/schema.js';
import { installed } from '../modules/installed.js';
import { hiddenProjectIds, projectAccess, projectOfWire, PROJECT_RANK } from './project-access.js';
import { allMetas, metaOf, schemaOf, tableOf, toWire } from './rows.js';

/** Drizzle transaction (or a connection inside a manual BEGIN). */
export type Q = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface ServerTxCtx {
  userId: string;
  /** id of the API token, if the write comes via Bearer (activity.viaTokenId) */
  tokenId?: string;
  /** ISO ts for activity; default — current time */
  now?: string;
}

type Wire = Record<string, unknown>;
export interface TxWrite {
  entity: EntityName;
  op: 'put' | 'del';
  before?: Wire;
  after?: Wire;
}
const RANK: Record<string, number> = { guest: 1, member: 2, admin: 3 };
/** seq order = commit order (C-sync "changes journal"). */
const LOCK_KEY = 7311;

function mapPgError(err: unknown): never {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.cause?.code ?? e.code;
  if (code === '23505') throw new MutatorError('conflict', 'нарушена уникальность');
  if (code && ['23503', '23502', '23514', '22P02', '22007', '22008'].includes(code))
    throw new MutatorError('invalid_args', 'данные нарушают ограничения БД');
  throw err;
}

// jsonb keys arrive in a different order than the client's
const stable = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/**
 * Tx on top of a DB transaction, rows in wire format. One mutation = one instance
 * (roles are cached per mutation). Call finish() before commit.
 */
export class ServerTx implements Tx {
  private roles = new Map<string, number>();
  private created = new Set<string>();
  /** Projects created by this transaction: their creator initializes the project's statuses (PJ-1). */
  private createdProjects = new Set<string>();
  private instanceRole?: string;
  /** PJ-11: project of a row (`entity:id` -> project id), the user's role in a project (0 — none), projects hidden from the user. */
  private projectOf = new Map<string, string | null>();
  private projectRanks = new Map<string, number>();
  private hidden?: Set<string>;
  private locked = false;
  private lastSeq = 0;
  /** Records of this mutation (for the notification hook). */
  readonly writes: TxWrite[] = [];

  constructor(
    private q: Q,
    private ctx: ServerTxCtx,
    private opts: { system?: boolean } = {},
  ) {}

  /** Server code: rights bypass, the write goes into changes. */
  static asSystem(q: Q, ctx: ServerTxCtx): ServerTx {
    return new ServerTx(q, ctx, { system: true });
  }

  /** Notification about what was written; call in the same transaction before commit. */
  async finish(): Promise<void> {
    if (this.lastSeq)
      await this.q.execute(sql`select pg_notify('planar_changes', ${String(this.lastSeq)})`);
  }

  /** Lock until the first read: read-then-write mutations are serialized (C-sync v2). */
  private async lock(): Promise<void> {
    if (this.locked) return;
    await this.q.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    this.locked = true;
  }

  /** The row as is, even in a project hidden from the user (put/patch check it in authorize). */
  private async rawGet<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined> {
    await this.lock();
    const t = tableOf(entity);
    const [r] = await this.exec(() =>
      this.q
        .select()
        .from(t)
        .where(eq(getTableColumns(t).id, id))
        .limit(1),
    );
    return r ? (toWire(entity, r) as Row<E>) : undefined;
  }

  /** PJ-11: a row of a project hidden from the user does not exist for the mutator. */
  async get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined> {
    const r = await this.rawGet(entity, id);
    return r && (await this.isHidden(entity, r)) ? undefined : r;
  }

  private async hiddenSet(): Promise<Set<string>> {
    return (this.hidden ??= new Set(await hiddenProjectIds(this.q, this.ctx.userId)));
  }

  private async isHidden(entity: string, row: Wire): Promise<boolean> {
    if (this.opts.system || !(await this.hiddenSet()).size) return false;
    const pid = await this.projectIdOf(entity, row);
    return !!pid && (await this.hiddenSet()).has(pid);
  }

  private async projectIdOf(entity: string, row: Wire): Promise<string | null> {
    return projectOfWire(this.q, entity, row, this.projectOf);
  }

  /** Rank of the user's role in the project (0 — no access); cached per mutation. */
  private async projectRank(projectId: string): Promise<number> {
    let r = this.projectRanks.get(projectId);
    if (r === undefined) {
      r = PROJECT_RANK[(await projectAccess(this.q, this.ctx.userId, projectId)) ?? ''] ?? 0;
      this.projectRanks.set(projectId, r);
    }
    return r;
  }

  /** Writes to projects / projectMembers / spaceMembers change who sees what: drop the caches. */
  private accessChanged(entity: string) {
    if (['projects', 'projectMembers', 'spaceMembers'].includes(entity)) {
      this.projectRanks.clear();
      this.hidden = undefined;
    }
  }

  /** extra — "DB-only" columns (users.passwordHash): written to the row, not into changes. */
  async put<E extends EntityName>(
    entity: E,
    row: Row<E>,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const next = this.parse(entity, row);
    await this.save(entity, next, await this.rawGet(entity, next.id as string), extra);
  }

  async patch<E extends EntityName>(
    entity: E,
    id: string,
    partial: Partial<Row<E>>,
  ): Promise<void> {
    const old = await this.get(entity, id);
    if (!old) throw new MutatorError('not_found', `${entity} ${id}: нет строки`);
    const defined = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined));
    await this.save(entity, this.parse(entity, { ...old, ...defined }), old);
  }

  async del<E extends EntityName>(entity: E, id: string): Promise<void> {
    const old = (await this.get(entity, id)) as Wire | undefined;
    if (!old) return;
    await this.authorize(entity, old, undefined);
    const t = tableOf(entity);
    await this.exec(() => this.q.delete(t).where(eq(getTableColumns(t).id, id)));
    await this.log(entity, 'del', old);
    await this.memberChange(entity, old, 'del');
    this.writes.push({ entity, op: 'del', before: old });
    this.accessChanged(entity);
    if (entity === 'spaceMembers' || entity === 'projectMembers')
      await this.reset(old.userId as string);
    await this.activity(entity, old, undefined);
  }

  async scan<E extends EntityName>(
    entity: E,
    opts?: { index: string; eq: unknown },
  ): Promise<Row<E>[]> {
    if (opts && !metaOf(entity).indexes.includes(opts.index))
      throw new Error(`scan: ${entity} не индексирован по ${opts.index}`);
    await this.lock();
    const t = tableOf(entity);
    const rows = await this.exec(() =>
      this.q
        .select()
        .from(t)
        .where(opts ? eq(getTableColumns(t)[opts.index], opts.eq) : undefined),
    );
    const out: Row<E>[] = [];
    for (const r of rows) {
      const w = toWire(entity, r) as Row<E>;
      if (!(await this.isHidden(entity, w))) out.push(w);
    }
    return out;
  }

  private async exec<T>(fn: () => PromiseLike<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      return mapPgError(err);
    }
  }

  private parse(entity: EntityName, row: unknown): Wire {
    const r = schemaOf(entity).safeParse(row);
    if (!r.success) throw new MutatorError('invalid_args', `${entity}: ${r.error.message}`);
    return r.data as Wire;
  }

  private async save(
    entity: EntityName,
    next: Wire,
    old: Wire | undefined,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const moved = entity !== 'spaces' && !!old && old.spaceId !== next.spaceId;
    // only a task or a docs page changes its space (PLNRAPP-152, PLNRAPP-5): its rows follow it in relocate()
    if (moved && entity !== 'tasks' && entity !== 'docsPages')
      throw new MutatorError('invalid_args', 'spaceId неизменяем');
    await this.authorize(entity, old, next);
    if (moved) {
      // del before put: a replica of both spaces must end up with the row
      const [id, from] = [next.id as string, (old!.projectId as string) ?? null];
      await this.append(old!.spaceId as string, null, entity, id, 'del', null, from);
      this.projectOf.set(`${entity}:${id}`, (next.projectId as string) ?? null);
    }
    if (entity === 'attachments' && !old) await this.checkFile(next);
    if (entity === 'settings' && next.id === 'enabled_modules')
      await this.checkAvailable(old?.value, next.value);
    if (entity === 'projects') await this.checkProjectModules(old, next);
    if (entity === 'projects') await this.checkMembersMode(old, next);
    if (entity === 'tasks' && next.number == null)
      next.number = await this.nextNumber(next.projectId as string);
    await this.store(entity, next, extra);
    if (moved) await this.relocate(entity, next, old!);
    if (!old) await this.memberChange(entity, next, 'put');
    this.writes.push({ entity, op: 'put', before: old, after: next });
    this.accessChanged(entity);
    // a role change (space role, instance role) changes access to custom projects: the replica is rebuilt
    if (
      (entity === 'spaceMembers' && (!old || old.role !== next.role)) ||
      entity === 'projectMembers'
    )
      await this.reset(next.userId as string);
    // a change of the project's composition: the replica of everyone in the space drops what it must (PJ-11)
    if (entity === 'projects' && old && old.membersMode !== next.membersMode)
      for (const m of await this.exec(() =>
        this.q
          .select({ u: schema.spaceMembers.userId })
          .from(schema.spaceMembers)
          .where(eq(schema.spaceMembers.spaceId, next.spaceId as string)),
      ))
        await this.reset(m.u);
    if (entity === 'settings' && next.id === 'enabled_modules')
      await this.log('_reset', 'put', null, next.id as string);
    await this.activity(entity, old, next);
  }

  /** C-mutators v5: a newly enabled module with unavailable ≠ null → invalid_args (reason code). */
  private async checkAvailable(oldIds: unknown, nextIds: unknown): Promise<void> {
    const was = Array.isArray(oldIds) ? oldIds : [];
    if (!Array.isArray(nextIds)) return;
    for (const id of nextIds) {
      if (was.includes(id)) continue;
      const code = await installed.find((m) => m.api.id === id)?.api.unavailable?.(this.q);
      if (code) throw new MutatorError('invalid_args', code);
    }
  }

  /** C-mutators v12: a change of projects.modules — admin of the space or instance admin; a newly enabled module must be available. */
  private async checkProjectModules(old: Wire | undefined, next: Wire): Promise<void> {
    // creation: any member may; the modules must be available
    if (!old) return this.checkAvailable([], next.modules);
    if (stable(old.modules ?? []) === stable(next.modules ?? [])) return;
    if (!this.opts.system) {
      const admin =
        (await this.spaceRole(next.spaceId as string)) >= RANK.admin ||
        ['owner', 'admin'].includes((await this.userRole())!);
      if (!admin) throw new MutatorError('forbidden', 'projects: модули меняет администратор');
    }
    await this.checkAvailable(old.modules, next.modules);
  }

  /** C-mutators v14: a change of projects.membersMode — admin of the space or instance admin. */
  private async checkMembersMode(old: Wire | undefined, next: Wire): Promise<void> {
    if (this.opts.system) return;
    if (!old ? next.membersMode === 'inherit' : old.membersMode === next.membersMode) return;
    if (!(await this.isSpaceOrInstanceAdmin(next.spaceId as string)))
      throw new MutatorError('forbidden', 'projects: состав меняет администратор');
  }

  private async isSpaceOrInstanceAdmin(spaceId: string): Promise<boolean> {
    return (
      (await this.spaceRole(spaceId)) >= RANK.admin ||
      ['owner', 'admin'].includes((await this.userRole())!)
    );
  }

  /** Write without rights check: upsert + changes. */
  private async store(
    entity: EntityName,
    next: Wire,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const t = tableOf(entity);
    const full = { ...next, ...extra };
    await this.exec(() =>
      this.q
        .insert(t)
        .values(full)
        .onConflictDoUpdate({ target: getTableColumns(t).id, set: full }),
    );
    await this.log(entity, 'put', next);
  }

  private async nextNumber(projectId: string): Promise<number> {
    const [r] = await this.exec(() =>
      this.q
        .update(schema.projects)
        .set({ taskCounter: sql`${schema.projects.taskCounter} + 1` })
        .where(eq(schema.projects.id, projectId))
        .returning({ n: schema.projects.taskCounter }),
    );
    if (!r) throw new MutatorError('invalid_args', 'проект не найден');
    return r.n;
  }

  /**
   * PLNRAPP-152, PLNRAPP-5: a task or docs page moved to another space takes along the rows tied to it — every space entity
   * (core and modules) with taskId or pageId, reactions to its comments: del in the old space, put in the new one;
   * no rights check and no hooks (the move itself is authorized). A child left behind is cut off.
   */
  private async relocate(entity: EntityName, row: Wire, old: Wire): Promise<void> {
    const id = row.id as string;
    const to = row.spaceId as string;
    // project of the old rows: the task or page's project before the move
    const before = new Map<string, string | null>([
      [`${entity}:${id}`, (old.projectId as string) ?? null],
    ]);
    if (entity === 'tasks') {
      const ofTask = this.q
        .select({ id: schema.comments.id })
        .from(schema.comments)
        .where(eq(schema.comments.taskId, id));
      for (const [e, m] of Object.entries(allMetas())) {
        if (m.scope !== 'space' || e === 'tasks') continue;
        const t = tableOf(e);
        const c = getTableColumns(t);
        const where = c.taskId
          ? eq(c.taskId, id)
          : c.commentId
            ? inArray(c.commentId, ofTask)
            : undefined;
        if (!where || !c.spaceId) continue;
        for (const r of await this.exec(() => this.q.select().from(t).where(where))) {
          const w = toWire(e, r);
          if (w.spaceId === to) continue;
          const pid = await projectOfWire(this.q, e, w, before);
          await this.append(w.spaceId as string, null, e, w.id as string, 'del', null, pid);
          await this.store(e as EntityName, { ...w, spaceId: to });
        }
      }
      const left = await this.exec(() =>
        this.q
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.parentId, id), ne(schema.tasks.spaceId, to))),
      );
      for (const r of left) await this.store('tasks', { ...toWire('tasks', r), parentId: null });
    } else if (entity === 'docsPages') {
      for (const [e, m] of Object.entries(allMetas())) {
        if (m.scope !== 'space' || e === 'docsPages') continue;
        const t = tableOf(e);
        const c = getTableColumns(t);
        const where = c.pageId
          ? eq(c.pageId, id)
          : e === 'docsLocks'
            ? eq(c.id, id)
            : undefined;
        if (!where || !c.spaceId) continue;
        for (const r of await this.exec(() => this.q.select().from(t).where(where))) {
          const w = toWire(e, r);
          if (w.spaceId === to) continue;
          const pid = await projectOfWire(this.q, e, w, before);
          await this.append(w.spaceId as string, null, e, w.id as string, 'del', null, pid);
          await this.store(e as EntityName, { ...w, spaceId: to });
        }
      }
      const t = tableOf('docsPages');
      const c = getTableColumns(t);
      const left = await this.exec(() =>
        this.q
          .select()
          .from(t)
          .where(and(eq(c.parentId, id), ne(c.spaceId, to))),
      );
      for (const r of left) await this.store('docsPages', { ...toWire('docsPages', r), parentId: null });
    }
  }

  /** `_reset` for one user: their replica is rebuilt from bootstrap. */
  reset(userId: string) {
    return this.log('_reset', 'put', null, userId, userId);
  }

  /** changes row. row null — service record (_reset) with explicit columns. */
  private async log(
    entity: string,
    op: 'put' | 'del',
    row: Wire | null,
    id = row?.id as string,
    resetUser?: string,
  ): Promise<void> {
    await this.lock();
    let spaceId: string | null = null;
    let userId: string | null = resetUser ?? null;
    let projectId: string | null = null;
    if (row && entity !== '_reset') {
      const meta = metaOf(entity);
      const scope = meta.scope;
      projectId = await this.projectIdOf(entity, row);
      if (scope === 'space|members' && row.spaceId == null) {
        // one row per member of the container (C-sync v2); state — after the write
        for (const u of await this.memberIds(entity, row))
          await this.append(null, u, entity, id, op, row, projectId);
        return;
      }
      const byUser = scope === 'user' || (scope === 'space|user' && row.userId != null);
      if (byUser) userId = row.userId as string;
      else if (scope !== 'global') spaceId = (entity === 'spaces' ? row.id : row.spaceId) as string;
    }
    await this.append(spaceId, userId, entity, id, op, op === 'put' ? row : null, projectId);
  }

  private async append(
    spaceId: string | null,
    userId: string | null,
    entity: string,
    id: string,
    op: 'put' | 'del',
    row: Wire | null,
    projectId: string | null = null,
  ) {
    const [c] = await this.exec(() =>
      this.q
        .insert(schema.changes)
        .values({
          spaceId,
          userId,
          projectId,
          entity,
          id,
          op,
          data: op === 'put' ? row : null,
        })
        .returning({ seq: schema.changes.seq }),
    );
    this.lastSeq = c.seq;
  }

  /** userIds of members of the container of an entity row of scope space|members. */
  private async memberIds(entity: string, row: Wire): Promise<string[]> {
    const m = metaOf(entity).members;
    if (!m) throw new Error(`${entity}: scope space|members без meta.members`);
    const t = tableOf(m.entity);
    const c = getTableColumns(t);
    const rows = await this.exec(() =>
      this.q.select({ u: c.userId }).from(t).where(eq(c[m.key], row[m.via])),
    );
    return rows.map((r) => r.u as string);
  }

  /**
   * A member was added/removed (members.entity row): they get put/del of the container and the bootstrap rows
   * of the container (only without spaceId — space rows are visible by space rules). We do not write _reset.
   */
  private async memberChange(entity: string, row: Wire, op: 'put' | 'del'): Promise<void> {
    const deps = Object.entries(allMetas()).filter(
      ([, m]) => m.scope === 'space|members' && m.members?.entity === entity,
    );
    if (!deps.length) return;
    const user = row.userId as string;
    const seen = new Set<string>();
    const send = async (e: string, id: string, data: Wire | null) => {
      if (seen.has(`${e}:${id}`)) return;
      seen.add(`${e}:${id}`);
      await this.append(null, user, e, id, op, data);
    };
    // a deleted member row is no longer found in the table; a new one has been broadcast by log() anyway
    if (op === 'del') await send(entity, row.id as string, null);
    else seen.add(`${entity}:${row.id}`);
    for (const [name, m] of deps) {
      const { key, via, container } = m.members!;
      const targets = [container, ...(m.bootstrap && name !== container ? [name] : [])];
      for (const e of targets) {
        const col = getTableColumns(tableOf(e))[e === container ? 'id' : via];
        const rows = await this.exec(() =>
          this.q.select().from(tableOf(e)).where(eq(col, row[key])),
        );
        if (op === 'del' && e === container) await send(e, row[key] as string, null);
        for (const r of rows) {
          const w = toWire(e, r);
          if (w.spaceId == null) await send(e, w.id as string, op === 'put' ? w : null);
        }
      }
    }
  }

  private async activity(entity: EntityName, old: Wire | undefined, next: Wire | undefined) {
    const row = (next ?? old)!;
    let kind: string | undefined;
    let changes: Wire = {};
    if (entity === 'tasks') {
      if (!next) kind = 'deleted';
      else if (!old) kind = 'created';
      else {
        for (const k of Object.keys(next)) {
          if (k === 'updatedAt' || k === 'rank') continue;
          if (stable(old[k]) !== stable(next[k])) changes[k] = [old[k], next[k]];
        }
        if (Object.keys(changes).length) kind = 'updated';
      }
    } else if (entity === 'taskAssignees') {
      kind = next ? 'assignee_added' : 'assignee_removed';
      changes = { userId: row.userId };
    } else if (entity === 'taskLabels') {
      kind = next ? 'label_added' : 'label_removed';
      changes = { labelId: row.labelId };
    } else if (entity === 'comments' && next && !old) {
      kind = 'commented';
      changes = { commentId: row.id };
    }
    if (!kind) return;
    await this.store(
      'activity',
      this.parse('activity', {
        id: uuidv7(),
        spaceId: row.spaceId,
        taskId: entity === 'tasks' ? row.id : row.taskId,
        actorId: this.ctx.userId,
        kind,
        changes,
        viaTokenId: this.ctx.tokenId ?? null,
        createdAt: this.ctx.now ?? new Date().toISOString(),
      }),
    );
  }

  private async spaceRole(spaceId: string): Promise<number> {
    if (this.created.has(spaceId)) return RANK.admin;
    let r = this.roles.get(spaceId);
    if (r === undefined) {
      const [m] = await this.exec(() =>
        this.q
          .select({ role: schema.spaceMembers.role })
          .from(schema.spaceMembers)
          .where(
            sql`${schema.spaceMembers.spaceId} = ${spaceId} and ${schema.spaceMembers.userId} = ${this.ctx.userId}`,
          ),
      );
      r = RANK[m?.role ?? ''] ?? 0;
      this.roles.set(spaceId, r);
    }
    return r;
  }

  private async userRole(): Promise<string | undefined> {
    if (!this.instanceRole) {
      const [u] = await this.exec(() =>
        this.q
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, this.ctx.userId)),
      );
      this.instanceRole = u?.role ?? 'guest';
    }
    return this.instanceRole;
  }

  /** Rights by ENTITIES[e].write for the old and new row (C-schema "Visibility and rights"). */
  private async authorize(entity: EntityName, old: Wire | undefined, next: Wire | undefined) {
    if (this.opts.system) return;
    const w = metaOf(entity).write;
    const forbidden = (m: string) => new MutatorError('forbidden', `${entity}: ${m}`);
    // PJ-11: a row of a project hidden from the user does not exist for them (not_found, not forbidden)
    for (const r of [old, next])
      if (r && (await this.isHidden(entity, r)))
        throw new MutatorError('not_found', `${entity}: нет строки`);
    if (entity === 'projectMembers') {
      for (const r of [old, next])
        if (r && !(await this.isSpaceOrInstanceAdmin(r.spaceId as string)))
          throw forbidden('состав проекта меняет администратор');
      return;
    }
    if (w === 'server') throw forbidden('запись только сервером');
    if (w === 'instance_admin') {
      if (!['owner', 'admin'].includes((await this.userRole())!))
        throw forbidden('нужна роль admin инстанса');
      return;
    }
    for (const r of [old, next]) {
      if (!r) continue;
      if (metaOf(entity).scope === 'space|members' && r.spaceId == null) {
        if (!(await this.canWriteMembers(entity, old, r)))
          throw forbidden('не участник контейнера');
        continue;
      }
      if (w === 'self') {
        if (r.userId !== this.ctx.userId) throw forbidden('чужая строка');
        continue;
      }
      const spaceId = (entity === 'spaces' ? r.id : r.spaceId) as string;
      if (entity === 'spaces' && r === next && !old) {
        if ((await this.userRole()) === 'guest') throw forbidden('гость не создаёт пространства');
        this.created.add(spaceId);
        continue;
      }
      if (w === 'member|self' && r.userId != null && r.userId !== this.ctx.userId)
        throw forbidden('личный вид другого пользователя');
      // project.create writes the new project's statuses (write: admin) on behalf of a member (projects.md §PJ-1)
      if (entity === 'statuses' && this.createdProjects.has(r.projectId as string)) continue;
      // project.setModule: an instance admin switches modules without being a member of the space (C-mutators v12)
      if (
        entity === 'projects' &&
        old &&
        next &&
        (stable(old.modules ?? []) !== stable(next.modules ?? []) ||
          old.membersMode !== next.membersMode) &&
        ['owner', 'admin'].includes((await this.userRole())!)
      )
        continue;
      const need = RANK[w === 'member|self' ? 'member' : w];
      // PJ-11: the role in the project is the SQL rule project_role (custom: projectMembers; admins: admin)
      let have = await this.spaceRole(spaceId);
      const pid =
        have && !(entity === 'projects' && !old) ? await this.projectIdOf(entity, r) : null;
      const pr = pid ? await this.projectRank(pid) : 0;
      if (pr) have = pr;
      if (have < need) throw forbidden('нет прав на пространство');
      if (entity === 'projects' && r === next && !old) this.createdProjects.add(r.id as string);
    }
  }

  /** space|members without spaceId: row[via] member or the container creator (C-sync v2). */
  private async canWriteMembers(entity: string, old: Wire | undefined, r: Wire): Promise<boolean> {
    if ((await this.memberIds(entity, r)).includes(this.ctx.userId)) return true;
    const m = metaOf(entity).members!;
    if (entity === m.container) return (old ?? r).createdBy === this.ctx.userId;
    const t = tableOf(m.container);
    const [c] = await this.exec(() =>
      this.q
        .select()
        .from(t)
        .where(eq(getTableColumns(t).id, r[m.via])),
    );
    return (c as Wire | undefined)?.createdBy === this.ctx.userId;
  }

  /** attachments: ctx.userId has file_uploads for the file, or the file is already attached in this space. */
  private async checkFile(row: Wire): Promise<void> {
    if (this.opts.system) return;
    const [u] = await this.exec(() =>
      this.q
        .select({ sha: schema.fileUploads.sha256 })
        .from(schema.fileUploads)
        .where(
          and(
            eq(schema.fileUploads.sha256, row.fileSha256 as string),
            eq(schema.fileUploads.userId, this.ctx.userId),
          ),
        ),
    );
    if (u) return;
    const [a] = await this.exec(() =>
      this.q
        .select({ id: schema.attachments.id })
        .from(schema.attachments)
        .where(
          and(
            eq(schema.attachments.fileSha256, row.fileSha256 as string),
            eq(schema.attachments.spaceId, row.spaceId as string),
          ),
        )
        .limit(1),
    );
    if (!a) throw new MutatorError('forbidden', 'файл не загружен этим пользователем');
  }
}
