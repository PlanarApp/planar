import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { mySpaceIds } from './my-spaces.js';
import { wsOpened } from '../metrics/metrics.js';
import { WebSocket, WebSocketServer } from 'ws';
import { wsClientSchema, wsTypingClientSchema } from '@planar/shared';
import { AUTH_OPTS, authenticateRaw, type AuthOpts } from '../auth/auth.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../auth/errors.js';
import { DB } from '../tokens.js';
import { ChangeNotifier, type PokeTarget, type WorkSignal } from './notify.js';
import { viewersOf } from './viewers.js';

const PING_MS = 30_000;
const TYPING_MS = 3000;

/** WS /ws: poke only (no data is sent), C-sync "WebSocket". */
@Injectable()
export class SyncGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private wss = new WebSocketServer({ noServer: true });
  private alive = new WeakSet<WebSocket>();
  private users = new WeakMap<WebSocket, string>();
  /** The user's spaces for addressed pokes; absent (not loaded yet / dropped) — poke and load. */
  private spaces = new WeakMap<WebSocket, Set<string>>();
  /** Bumped on a membership change: a load that started before it must not store its stale result. */
  private spacesGen = 0;
  /** (userId, id) -> time of the last typing broadcast */
  private typed = new Map<string, number>();
  private server?: Server;
  private off?: () => void;
  private offWork?: () => void;
  private ping?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private db: Db,
    @Inject(AUTH_OPTS) private auth: AuthOpts,
    @Inject(ChangeNotifier) private notifier: ChangeNotifier,
    @Inject(HttpAdapterHost) private host: HttpAdapterHost,
  ) {}

  onApplicationBootstrap() {
    this.server = this.host.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.onUpgrade);
    this.off = this.notifier.subscribe((seq, t) => this.broadcast(seq, t));
    this.offWork = this.notifier.subscribeWork((w) => void this.onWork(w));
    this.ping = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!this.alive.has(ws)) ws.terminate();
        else {
          this.alive.delete(ws);
          ws.ping();
        }
      }
    }, PING_MS);
    this.ping.unref();
  }

  onModuleDestroy() {
    clearInterval(this.ping);
    this.off?.();
    this.offWork?.();
    this.server?.off('upgrade', this.onUpgrade);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return;
    socket.on('error', () => {});
    let ctx;
    try {
      ctx = await authenticateRaw(this.db, req.headers, 'UPGRADE', {
        publicUrl: this.auth.publicUrl,
        allowToken: false, // Bearer on /ws is not parsed: last_used_at is not touched
      });
    } catch (e) {
      const status = e instanceof HttpError ? e.getStatus() : 500;
      socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\n\r\n`);
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      if (!ctx || ctx.via === 'token') return ws.close(4401, 'unauthenticated');
      const closed = wsOpened('/ws');
      ws.on('close', closed);
      this.alive.add(ws);
      this.users.set(ws, ctx.userId);
      ws.on('pong', () => this.alive.add(ws));
      ws.on('error', () => {});
      ws.on('message', (raw) => void this.onMessage(ws, raw.toString()));
    });
  };

  private async onMessage(ws: WebSocket, raw: string) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const typing = wsTypingClientSchema.safeParse(json);
    if (typing.success) return this.onTyping(ws, typing.data);
    const hello = wsClientSchema.safeParse(json);
    if (!hello.success) return; // ignore others' messages
    const msg = hello.data;
    try {
      const r = await this.db.execute(
        sql`select coalesce(max(seq), 0)::float8 as seq from changes`,
      );
      const max = Number(r.rows[0].seq);
      if (max > msg.cursor) this.poke(ws, max);
    } catch {
      // DB unavailable: the client gets a poke with the next change
    }
  }

  /** "Typing…" (C-sync v2): only to those who see the row; at most once per 3 s per (sender, id). */
  private async onTyping(ws: WebSocket, m: { entity: string; id: string }) {
    const from = this.users.get(ws);
    if (!from) return;
    try {
      const viewers = await viewersOf(this.db, m.entity, m.id);
      if (!viewers?.has(from)) return;
      const k = `${from}:${m.id}`;
      const now = Date.now();
      if (now - (this.typed.get(k) ?? 0) < TYPING_MS) return;
      for (const [kk, t] of this.typed) if (now - t >= TYPING_MS) this.typed.delete(kk);
      this.typed.set(k, now);
      const out = JSON.stringify({ t: 'typing', entity: m.entity, id: m.id, userId: from });
      for (const c of this.wss.clients) {
        const u = this.users.get(c);
        if (u && u !== from && viewers.has(u) && c.readyState === WebSocket.OPEN) c.send(out);
      }
    } catch {
      // ephemeral message: a DB failure is silent
    }
  }

  /** PLNRAPP-884: the work of a row changed — only to those who see the row (no data, the client reloads it). */
  private async onWork(w: WorkSignal) {
    if (!this.wss.clients.size) return;
    try {
      const viewers = await viewersOf(this.db, w.entity, w.id);
      if (!viewers?.size) return;
      const out = JSON.stringify({ t: 'work', entity: w.entity, id: w.id, projectId: w.projectId });
      for (const c of this.wss.clients) {
        const u = this.users.get(c);
        if (u && viewers.has(u) && c.readyState === WebSocket.OPEN) c.send(out);
      }
    } catch {
      // ephemeral signal: a DB failure is silent, the next one or a reconnect reloads
    }
  }

  private poke(ws: WebSocket, seq: number) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'poke', seq }));
  }

  private async loadSpaces(ws: WebSocket, userId: string) {
    const gen = this.spacesGen;
    try {
      const ids = await mySpaceIds(this.db, userId);
      if (gen === this.spacesGen) this.spaces.set(ws, new Set(ids));
    } catch {
      // not cached: the next poke goes out unaddressed and loads again
    }
  }

  /** Only to those the change concerns; in doubt (spaces not loaded) — poke: an extra poke is harmless, a missed one is not. */
  private broadcast(seq: number, t: PokeTarget) {
    if (t.membership) {
      this.spacesGen++;
      for (const ws of this.wss.clients) this.spaces.delete(ws);
    }
    for (const ws of this.wss.clients) {
      const u = this.users.get(ws);
      const mine = u ? this.spaces.get(ws) : undefined;
      if (u && !mine) void this.loadSpaces(ws, u);
      if (t.all || !u || !mine || t.users.has(u) || [...t.spaces].some((s) => mine.has(s)))
        this.poke(ws, seq);
    }
  }
}
