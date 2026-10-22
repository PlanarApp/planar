import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import type { Db } from '../db/index.js';
import { DB } from '../tokens.js';

const CHANNEL = 'planar_changes';
const COALESCE_MS = 50;
const RECONNECT_MS = 1000;

/** Одно LISTEN-соединение на процесс; подписчики получают последний seq пачки (склейка ≤ 50 мс). */
@Injectable()
export class ChangeNotifier implements OnModuleInit, OnModuleDestroy {
  private subs = new Set<(seq: number) => void>();
  private client?: pg.Client;
  private closed = false;
  private retry?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;
  private pending = 0;

  constructor(@Inject(DB) private db: Db) {}

  onModuleInit() {
    void this.connect();
  }

  async onModuleDestroy() {
    this.closed = true;
    clearTimeout(this.retry);
    clearTimeout(this.flushTimer);
    const c = this.client;
    this.client = undefined;
    await c?.end().catch(() => {});
    this.subs.clear();
  }

  subscribe(cb: (seq: number) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private async connect() {
    if (this.closed) return;
    const client = new pg.Client(this.db.$client.options);
    const lost = () => {
      if (this.client !== client) return;
      this.client = undefined;
      client.removeAllListeners();
      client.on('error', () => {});
      void client.end().catch(() => {});
      if (!this.closed) this.retry = setTimeout(() => void this.connect(), RECONNECT_MS);
    };
    client.on('error', lost);
    client.on('end', lost);
    client.on('notification', (m) => this.push(Number(m.payload)));
    this.client = client;
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      // пока соединения не было, уведомления могли пропасть
      const r = await this.db.$client.query('select coalesce(max(seq), 0) as seq from changes');
      this.push(Number(r.rows[0].seq));
    } catch {
      lost();
    }
  }

  private push(seq: number) {
    if (!seq) return;
    this.pending = Math.max(this.pending, seq);
    this.flushTimer ??= setTimeout(() => {
      const s = this.pending;
      this.pending = 0;
      this.flushTimer = undefined;
      for (const cb of this.subs) cb(s);
    }, COALESCE_MS);
  }
}
