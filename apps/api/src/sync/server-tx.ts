import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { MutatorError, uuidv7, type EntityName, type Row, type Tx } from '@planar/shared';
import * as schema from '../db/schema.js';
import { allMetas, metaOf, schemaOf, tableOf, toWire } from './rows.js';

/** Drizzle-транзакция (или соединение внутри ручного BEGIN). */
export type Q = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface ServerTxCtx {
  userId: string;
  /** id API-токена, если запись идёт через Bearer (activity.viaTokenId) */
  tokenId?: string;
  /** ISO ts для activity; по умолчанию — текущее время */
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
/** Порядок seq = порядок коммитов (C-sync «Журнал changes»). */
const LOCK_KEY = 7311;

function mapPgError(err: unknown): never {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.cause?.code ?? e.code;
  if (code === '23505') throw new MutatorError('conflict', 'нарушена уникальность');
  if (code && ['23503', '23502', '23514', '22P02', '22007', '22008'].includes(code))
    throw new MutatorError('invalid_args', 'данные нарушают ограничения БД');
  throw err;
}

// ключи jsonb приходят в другом порядке, чем у клиента
const stable = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/**
 * Tx поверх транзакции БД, строки в формате провода. Одна мутация = один экземпляр
 * (роли кешируются на мутацию). Перед коммитом вызвать finish().
 */
export class ServerTx implements Tx {
  private roles = new Map<string, number>();
  private created = new Set<string>();
  private instanceRole?: string;
  private locked = false;
  private lastSeq = 0;
  /** Записи этой мутации (для хука уведомлений). */
  readonly writes: TxWrite[] = [];

  constructor(
    private q: Q,
    private ctx: ServerTxCtx,
    private opts: { system?: boolean } = {},
  ) {}

  /** Серверный код: обход прав, запись попадает в changes. */
  static asSystem(q: Q, ctx: ServerTxCtx): ServerTx {
    return new ServerTx(q, ctx, { system: true });
  }

  /** Оповещение о записанном; вызывать в той же транзакции перед коммитом. */
  async finish(): Promise<void> {
    if (this.lastSeq)
      await this.q.execute(sql`select pg_notify('planar_changes', ${String(this.lastSeq)})`);
  }

  /** Лок до первого чтения: мутации «чтение-затем-запись» сериализуются (C-sync v2). */
  private async lock(): Promise<void> {
    if (this.locked) return;
    await this.q.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    this.locked = true;
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined> {
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

  /** extra — колонки «только в БД» (users.passwordHash): пишутся в строку, в changes не попадают. */
  async put<E extends EntityName>(
    entity: E,
    row: Row<E>,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const next = this.parse(entity, row);
    await this.save(entity, next, await this.get(entity, next.id as string), extra);
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
    if (entity === 'spaceMembers') await this.reset(old.userId as string);
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
    return rows.map((r) => toWire(entity, r) as Row<E>);
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
    if (entity !== 'spaces' && old && old.spaceId !== next.spaceId)
      throw new MutatorError('invalid_args', 'spaceId неизменяем');
    await this.authorize(entity, old, next);
    if (entity === 'attachments' && !old) await this.checkFile(next);
    if (entity === 'tasks' && next.number == null)
      next.number = await this.nextNumber(next.projectId as string);
    await this.store(entity, next, extra);
    if (!old) await this.memberChange(entity, next, 'put');
    this.writes.push({ entity, op: 'put', before: old, after: next });
    if (entity === 'spaceMembers' && !old) await this.reset(next.userId as string);
    if (entity === 'settings' && next.id === 'enabled_modules')
      await this.log('_reset', 'put', null, next.id as string);
    await this.activity(entity, old, next);
  }

  /** Запись без проверки прав: upsert + changes. */
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

  private reset(userId: string) {
    return this.log('_reset', 'put', null, userId, userId);
  }

  /** Строка changes. row null — служебная запись (_reset) с явными колонками. */
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
    if (row && entity !== '_reset') {
      const meta = metaOf(entity);
      const scope = meta.scope;
      if (scope === 'space|members' && row.spaceId == null) {
        // по строке на участника контейнера (C-sync v2); состояние — после записи
        for (const u of await this.memberIds(entity, row))
          await this.append(null, u, entity, id, op, row);
        return;
      }
      const byUser = scope === 'user' || (scope === 'space|user' && row.userId != null);
      if (byUser) userId = row.userId as string;
      else if (scope !== 'global') spaceId = (entity === 'spaces' ? row.id : row.spaceId) as string;
    }
    await this.append(spaceId, userId, entity, id, op, op === 'put' ? row : null);
  }

  private async append(
    spaceId: string | null,
    userId: string | null,
    entity: string,
    id: string,
    op: 'put' | 'del',
    row: Wire | null,
  ) {
    const [c] = await this.exec(() =>
      this.q
        .insert(schema.changes)
        .values({ spaceId, userId, entity, id, op, data: op === 'put' ? row : null })
        .returning({ seq: schema.changes.seq }),
    );
    this.lastSeq = c.seq;
  }

  /** userId участников контейнера строки сущности scope space|members. */
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
   * Добавили/убрали участника (строка members.entity): ему put/del контейнера и bootstrap-строк
   * контейнера (только без spaceId — строки пространства видны по правилам space). _reset не пишем.
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
    // удалённая строка участника уже не найдётся в таблице; новая и так разослана log()
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

  /** Права по ENTITIES[e].write для старой и новой строки (C-schema «Видимость и права»). */
  private async authorize(entity: EntityName, old: Wire | undefined, next: Wire | undefined) {
    if (this.opts.system) return;
    const w = metaOf(entity).write;
    const forbidden = (m: string) => new MutatorError('forbidden', `${entity}: ${m}`);
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
      if (w === 'member|self' && r.userId != null && r.spaceId == null) continue;
      const need = RANK[w === 'member|self' ? 'member' : w];
      if ((await this.spaceRole(spaceId)) < need) throw forbidden('нет прав на пространство');
    }
  }

  /** space|members без spaceId: участник row[via] или создатель контейнера (C-sync v2). */
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

  /** attachments: у ctx.userId есть file_uploads на файл либо файл уже приложен в этом пространстве. */
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
