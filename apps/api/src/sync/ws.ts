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
import { wsOpened } from '../metrics/metrics.js';
import { WebSocket, WebSocketServer } from 'ws';
import { wsClientSchema, wsTypingClientSchema } from '@planar/shared';
import { AUTH_OPTS, authenticateRaw, type AuthOpts } from '../auth/auth.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../auth/errors.js';
import { DB } from '../tokens.js';
import { ChangeNotifier } from './notify.js';
import { viewersOf } from './viewers.js';

const PING_MS = 30_000;
const TYPING_MS = 3000;

/** WS /ws: только poke (данные не передаются), C-sync «WebSocket». */
@Injectable()
export class SyncGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private wss = new WebSocketServer({ noServer: true });
  private alive = new WeakSet<WebSocket>();
  private users = new WeakMap<WebSocket, string>();
  /** (userId, id) -> время последней рассылки typing */
  private typed = new Map<string, number>();
  private server?: Server;
  private off?: () => void;
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
    this.off = this.notifier.subscribe((seq) => this.broadcast(seq));
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
        allowToken: false, // Bearer на /ws не разбираем: last_used_at не трогаем
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
    if (!hello.success) return; // чужие сообщения игнорируем
    const msg = hello.data;
    try {
      const r = await this.db.execute(
        sql`select coalesce(max(seq), 0)::float8 as seq from changes`,
      );
      const max = Number(r.rows[0].seq);
      if (max > msg.cursor) this.poke(ws, max);
    } catch {
      // БД недоступна: клиент получит poke со следующим изменением
    }
  }

  /** «Печатает…» (C-sync v2): только тем, кто видит строку; не чаще раза в 3 с на (отправитель, id). */
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
      // эфемерное сообщение: сбой БД молча
    }
  }

  private poke(ws: WebSocket, seq: number) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'poke', seq }));
  }

  private broadcast(seq: number) {
    for (const ws of this.wss.clients) this.poke(ws, seq);
  }
}
