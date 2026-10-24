import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Hocuspocus } from '@hocuspocus/server';
import { eq, sql } from 'drizzle-orm';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { AUTH_OPTS, authenticateRaw, type AuthOpts } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import type { Db } from '../db/index.js';
import { tasks, ydocs } from '../db/schema.js';
import { enabledModules } from '../modules/enabled.js';
import { PushQueue } from '../push/push.js';
import { executeMutations } from '../sync/mutate.js';
import { ChangeNotifier } from '../sync/notify.js';
import { DB } from '../tokens.js';
import { COLLAB_OPTS, type CollabOpts } from './options.js';
import { fill, normalize as toNorm, same, toJson, type Json } from './ydoc.js';

type Ctx = { userId: string };
const NAME = /^(docs|task):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const PING_MS = 10_000;
const key = (j: Json | null) => JSON.stringify(j);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hocuspocus на WS /collab: права на документ, хранение в ydocs, проекция в body/description (P3-collab, P3-ydoc). */
@Injectable()
export class CollabService implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('collab');
  private wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  readonly hp: Hocuspocus<Ctx>;
  private server?: Server;
  private off?: () => void;
  private ping?: NodeJS.Timeout;
  private last = 0;
  private chain: Promise<void> = Promise.resolve();
  /** Что проекция записала последним: её собственная запись не «внешняя», даже если в Y уже есть новые правки. */
  private projected = new Map<string, string[]>();
  /** seq журнала на момент загрузки документа: более ранние записи уже учтены в Y.Doc. */
  private loadedAt = new Map<string, number>();

  constructor(
    @Inject(DB) private db: Db,
    @Inject(AUTH_OPTS) private auth: AuthOpts,
    @Inject(ChangeNotifier) private notifier: ChangeNotifier,
    @Inject(HttpAdapterHost) private host: HttpAdapterHost,
    @Inject(PushQueue) private queue: PushQueue,
    @Inject(COLLAB_OPTS) private opts: CollabOpts,
  ) {
    this.hp = new Hocuspocus<Ctx>({
      quiet: true,
      debounce: opts.debounceMs,
      maxDebounce: opts.maxDebounceMs,
      onAuthenticate: async ({ documentName, context, connectionConfig }) => {
        const a = await this.access(context.userId, documentName);
        if (!a) throw new Error('forbidden');
        connectionConfig.readOnly = a.readOnly;
      },
      afterUnloadDocument: async ({ documentName }) => {
        this.projected.delete(documentName);
        this.loadedAt.delete(documentName);
      },
      onLoadDocument: ({ documentName, document }) => this.load(documentName, document),
      onStoreDocument: ({ documentName, document, lastContext }) =>
        this.store(documentName, document, (lastContext as Partial<Ctx> | undefined)?.userId),
    });
  }

  async onApplicationBootstrap() {
    this.server = this.host.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.onUpgrade);
    // БД недоступна — приложение всё равно стартует: стартовую точку возьмёт первое уведомление
    this.last = await this.maxSeq().catch(() => -1);
    this.off = this.notifier.subscribe(
      () => (this.chain = this.chain.then(() => this.onChanges()).catch((e) => this.log.error(e))),
    );
    this.ping = setInterval(() => {
      for (const ws of this.wss.clients) ws.ping();
    }, PING_MS);
    this.ping.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.ping);
    this.off?.();
    this.server?.off('upgrade', this.onUpgrade);
    for (const ws of this.wss.clients) ws.terminate();
    this.hp.flushPendingStores();
    // дожидаемся сохранений, пока пул БД ещё открыт
    const busy = () =>
      this.hp.documents.size > 0 ||
      this.hp.unloadingDocuments.size > 0 ||
      this.hp.loadingDocuments.size > 0;
    for (let i = 0; i < 100 && busy(); i++) await sleep(20);
    await this.chain;
    this.wss.close();
  }

  private onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/collab') return;
    socket.on('error', () => {});
    let userId: string | undefined;
    try {
      const ctx = await authenticateRaw(this.db, req.headers, 'UPGRADE', {
        publicUrl: this.auth.publicUrl,
        allowToken: false,
      });
      if (ctx?.via === 'session') userId = ctx.userId;
      else throw new HttpError(401, 'unauthenticated', 'Требуется вход');
    } catch (e) {
      const status = e instanceof HttpError ? e.getStatus() : 500;
      socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\n\r\n`);
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const request = new Request(`http://localhost${req.url}`, { headers });
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = this.hp.handleConnection(ws as never, request, { userId: userId! });
      ws.on('message', (raw) => conn.handleMessage(new Uint8Array(raw as Buffer)));
      ws.on('pong', () => conn.touch());
      ws.on('close', (code, reason) => conn.handleClose({ code, reason: reason.toString() }));
      ws.on('error', () => {});
    });
  };

  private async maxSeq(): Promise<number> {
    const r = await this.db.execute(sql`select coalesce(max(seq), 0)::float8 as seq from changes`);
    return Number(r.rows[0]!.seq);
  }

  /** Права на документ; null — отказ. Только чтение: guest или архивная страница. */
  async access(userId: string, name: string): Promise<{ readOnly: boolean } | null> {
    const m = NAME.exec(name);
    if (!m) return null;
    const [, kind, id] = m;
    let spaceId: string | undefined;
    let readOnly = false;
    if (kind === 'docs') {
      if (!(await enabledModules(this.db)).has('docs')) return null;
      const r = await this.db.execute(
        sql`select space_id, archived_at from docs_pages where id = ${id}`,
      );
      const p = r.rows[0] as { space_id: string; archived_at: string | null } | undefined;
      spaceId = p?.space_id;
      readOnly = !!p?.archived_at;
    } else {
      const [t] = await this.db.select({ s: tasks.spaceId }).from(tasks).where(eq(tasks.id, id!));
      spaceId = t?.s;
    }
    if (!spaceId) return null;
    const r = await this.db.execute(sql`
      select m.role from space_members m join users u on u.id = m.user_id
      where m.space_id = ${spaceId} and m.user_id = ${userId} and u.deactivated_at is null`);
    const role = (r.rows[0] as { role: string } | undefined)?.role;
    if (!role) return null;
    return { readOnly: readOnly || role === 'guest' };
  }

  /** Содержимое сущности (body / description); undefined — сущности нет. */
  private async current(name: string): Promise<{ json: Json | null } | undefined> {
    const [, kind, id] = NAME.exec(name)!;
    if (kind === 'docs') {
      const r = await this.db.execute(sql`select body from docs_pages where id = ${id}`);
      return r.rows[0] ? { json: (r.rows[0] as { body: Json }).body } : undefined;
    }
    const [t] = await this.db.select({ d: tasks.description }).from(tasks).where(eq(tasks.id, id!));
    return t ? { json: t.d } : undefined;
  }

  private async load(name: string, doc: Y.Doc) {
    this.loadedAt.set(name, await this.maxSeq());
    const [row] = await this.db.select().from(ydocs).where(eq(ydocs.docId, name));
    if (row) return void Y.applyUpdate(doc, row.state);
    const cur = await this.current(name);
    if (!cur) throw new Error('not_found');
    // тело нечитаемо схемой — исключение: лучше отказ, чем пустой документ поверх данных
    doc.transact(() => fill(doc, cur.json));
    // база сохраняется сразу: два клиента, строившие Y.Doc каждый сам, при слиянии удвоили бы текст
    await this.db
      .insert(ydocs)
      .values({ docId: name, state: Buffer.from(Y.encodeStateAsUpdate(doc)) })
      .onConflictDoNothing();
  }

  private async store(name: string, doc: Y.Doc, userId?: string) {
    const cur = await this.current(name);
    if (!cur) return void (await this.db.delete(ydocs).where(eq(ydocs.docId, name)));
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await this.db
      .insert(ydocs)
      .values({ docId: name, state })
      .onConflictDoUpdate({ target: ydocs.docId, set: { state, updatedAt: sql`now()` } });
    if (!userId) return;
    const next = toJson(doc);
    if (same(cur.json, next)) return;
    const [, kind, id] = NAME.exec(name)!;
    const docs = kind === 'docs';
    const mine = this.projected.get(name) ?? [];
    this.projected.set(name, [...mine.slice(-7), key(next)]);
    try {
      await executeMutations(
        this.db,
        userId,
        [
          docs
            ? { name: 'docs.page.update', args: { id, body: next ?? { type: 'doc', content: [] } } }
            : { name: 'task.update', args: { id, description: next } },
        ],
        this.queue,
      );
    } catch (e) {
      // ydocs уже сохранён, следующее сохранение попробует снова
      this.projected.set(name, mine);
      this.log.warn(`проекция ${name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Новые строки changes: внешняя запись body/description, удаления, выход участников. */
  private async onChanges() {
    const max = await this.maxSeq();
    if (this.last < 0) this.last = max;
    if (max <= this.last) return;
    const r = await this.db.execute(sql`
      select seq::float8 as seq, entity, id, op, data from changes
      where seq > ${this.last} and seq <= ${max}
        and entity in ('docsPages', 'tasks', 'spaceMembers', 'users')
      order by seq`);
    this.last = max;
    let recheck = false;
    for (const c of r.rows as {
      seq: number;
      entity: string;
      id: string;
      op: string;
      data: Json | null;
    }[]) {
      if (c.entity === 'spaceMembers' || c.entity === 'users') {
        recheck ||= c.op === 'del' || !!c.data?.deactivatedAt;
        continue;
      }
      const name = `${c.entity === 'tasks' ? 'task' : 'docs'}:${c.id}`;
      if (c.op === 'del') await this.purge(name);
      else
        await this.external(
          name,
          ((c.entity === 'tasks' ? c.data?.description : c.data?.body) as Json | null) ?? null,
          Number(c.seq),
        );
    }
    if (recheck) await this.recheck();
  }

  private async purge(name: string) {
    this.hp.closeConnections(name);
    await this.db.delete(ydocs).where(eq(ydocs.docId, name));
  }

  /** Запись body/description: равна проекции Y.Doc — ничего; иначе заменяем Y.Doc или удаляем ydocs. */
  private async external(name: string, json: Json | null, seq: number) {
    const loaded = this.hp.documents.get(name);
    if (loaded) {
      // своя проекция или запись, учтённая при загрузке, — не внешняя (иначе откатим набранное)
      if (this.projected.get(name)?.includes(key(normalizeSafe(json)))) return;
      if (seq <= (this.loadedAt.get(name) ?? 0)) return;
      if (same(json, toJson(loaded))) return;
      loaded.transact(() => fill(loaded, json), { source: 'local', context: {} });
      return;
    }
    const [row] = await this.db.select().from(ydocs).where(eq(ydocs.docId, name));
    if (!row) return;
    const y = new Y.Doc();
    Y.applyUpdate(y, row.state);
    if (!same(json, toJson(y))) await this.db.delete(ydocs).where(eq(ydocs.docId, name));
  }

  /** Закрывает соединения тех, у кого пропал доступ (удалён из пространства, деактивирован). */
  private async recheck() {
    for (const doc of [...this.hp.documents.values()])
      for (const c of doc.getConnections()) {
        const u = (c.context as Ctx).userId;
        if (!(await this.access(u, doc.name))) c.close({ code: 4403, reason: 'forbidden' });
      }
  }
}

function normalizeSafe(j: Json | null): Json | null {
  try {
    return toNorm(j);
  } catch {
    return j;
  }
}
