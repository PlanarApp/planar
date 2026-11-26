import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import type { Db } from '../db/index.js';
import { DB } from '../tokens.js';

const CHANNEL = 'planar_changes';
/** pg_notify payload is ≤ 8000 bytes: with more addressees than this the poke goes to everyone */
const MAX_TARGETS = 30;

/** Addressees of a poke: `all` — everyone; else sockets of the users and of members of the spaces. */
export interface PokeTarget {
  all: boolean;
  spaces: Set<string>;
  users: Set<string>;
  /** membership (spaces / spaceMembers) changed: sockets drop their cached spaces */
  membership: boolean;
}

/** Writer side: collects whom the changes of a transaction concern → payload. */
export class Notify {
  private t: PokeTarget = { all: false, spaces: new Set(), users: new Set(), membership: false };

  add(spaceId: string | null, userId: string | null, entity: string) {
    if (!spaceId && !userId) this.t.all = true; // a global row — to everyone
    if (spaceId) this.t.spaces.add(spaceId);
    if (userId) this.t.users.add(userId);
    if (entity === 'spaces' || entity === 'spaceMembers') this.t.membership = true;
  }

  payload(seq: number): string {
    const { all, spaces, users, membership } = this.t;
    // membership changed: the recipient's own spaces change, so the space address is not enough
    if (all || membership || spaces.size + users.size > MAX_TARGETS)
      return JSON.stringify({ seq, all: true, membership });
    return JSON.stringify({ seq, spaces: [...spaces], users: [...users] });
  }
}

/** Legacy payload — a bare number: no addressees known → everyone. */
export function parsePayload(raw: string | undefined): { seq: number; target: PokeTarget } {
  const all = (seq: number, membership = false) => ({ seq, target: everyone(membership) });
  try {
    const j = JSON.parse(raw ?? '');
    if (typeof j === 'number') return all(j);
    const seq = Number(j.seq);
    if (j.all || !Array.isArray(j.spaces) || !Array.isArray(j.users))
      return all(seq, !!j.membership);
    return {
      seq,
      target: { all: false, spaces: new Set(j.spaces), users: new Set(j.users), membership: false },
    };
  } catch {
    return all(Number(raw));
  }
}
const COALESCE_MS = 50;
const RECONNECT_MS = 1000;

/** One LISTEN connection per process; subscribers get the last seq of the batch (coalescing ≤ 50 ms). */
@Injectable()
export class ChangeNotifier implements OnModuleInit, OnModuleDestroy {
  private subs = new Set<(seq: number, target: PokeTarget) => void>();
  private client?: pg.Client;
  private closed = false;
  private retry?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;
  private pending = 0;
  private pendingTarget?: PokeTarget;

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

  subscribe(cb: (seq: number, target: PokeTarget) => void): () => void {
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
    client.on('notification', (m) => {
      const { seq, target } = parsePayload(m.payload);
      this.push(seq, target);
    });
    this.client = client;
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      // while there was no connection, notifications could have been lost
      const r = await this.db.$client.query('select coalesce(max(seq), 0) as seq from changes');
      this.push(Number(r.rows[0].seq), everyone());
    } catch {
      lost();
    }
  }

  /** The first notification goes out at once; a batch within the next 50 ms is merged into one broadcast. */
  private push(seq: number, target: PokeTarget) {
    if (!seq) return;
    if (this.flushTimer) {
      this.pending = Math.max(this.pending, seq);
      this.pendingTarget = merge(this.pendingTarget, target);
      return;
    }
    this.emit(seq, target);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      const s = this.pending;
      const t = this.pendingTarget;
      this.pending = 0;
      this.pendingTarget = undefined;
      if (s && t) this.emit(s, t);
    }, COALESCE_MS);
  }

  private emit(seq: number, target: PokeTarget) {
    for (const cb of this.subs) cb(seq, target);
  }
}

const everyone = (membership = false): PokeTarget => ({
  all: true,
  spaces: new Set(),
  users: new Set(),
  membership,
});

function merge(a: PokeTarget | undefined, b: PokeTarget): PokeTarget {
  if (!a) return b;
  return {
    all: a.all || b.all,
    spaces: new Set([...a.spaces, ...b.spaces]),
    users: new Set([...a.users, ...b.users]),
    membership: a.membership || b.membership,
  };
}
