import { randomBytes } from 'node:crypto';
import { request, type APIRequestContext } from '@playwright/test';
import { generateKeyBetween } from 'fractional-indexing';
import WebSocket from 'ws';

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export function uuidv7(): string {
  const b = randomBytes(16);
  b.writeUIntBE(Date.now(), 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** n increasing ranks (fractional-indexing). */
export function ranks(n: number): string[] {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) out.push((prev = generateKeyBetween(prev, null)));
  return out;
}

export interface Mutation {
  id: number;
  name: string;
  args: Record<string, unknown>;
}
export interface PushResult {
  id: number;
  ok: boolean;
  code?: string;
  message?: string;
}
export type Data = Record<string, Record<string, unknown>[]>;
export interface Pull {
  cursor: number;
  lastMutationId: number;
  changes: { seq: number; entity: string; id: string; op: string; data?: unknown }[];
  reset?: boolean;
}

/** C-sync protocol client: session, its own clientId and mutation counter. */
export class Client {
  clientId = uuidv7();
  mid = 0;
  constructor(
    public ctx: APIRequestContext,
    public userId: string,
  ) {}

  static async login(login: string): Promise<Client> {
    const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
    const r = await ctx.post('/api/auth/login', { data: { login, password: login } });
    if (!r.ok()) throw new Error(`login ${login}: ${r.status()}`);
    return new Client(ctx, (await r.json()).user.id);
  }

  /** Mutation with the next id (does not send). */
  mut(name: string, args: Record<string, unknown>): Mutation {
    return { id: ++this.mid, name, args };
  }

  async push(mutations: Mutation[]): Promise<PushResult[]> {
    const r = await this.ctx.post('/sync/push', { data: { clientId: this.clientId, mutations } });
    if (!r.ok()) throw new Error(`push: ${r.status()} ${await r.text()}`);
    return (await r.json()).results;
  }

  /** Send and make sure all of them are accepted. */
  async pushOk(mutations: Mutation[]): Promise<void> {
    for (const x of await this.push(mutations))
      if (!x.ok) throw new Error(`mutation ${x.id}: ${x.code} ${x.message}`);
  }

  async bootstrap(): Promise<{ cursor: number; lastMutationId: number; data: Data }> {
    const r = await this.ctx.get(`/sync/bootstrap?clientId=${this.clientId}`);
    if (!r.ok()) throw new Error(`bootstrap: ${r.status()}`);
    return r.json();
  }

  async pull(cursor: number): Promise<Pull> {
    const r = await this.ctx.get(`/sync/pull?cursor=${cursor}&clientId=${this.clientId}`);
    if (!r.ok()) throw new Error(`pull: ${r.status()}`);
    return r.json();
  }

  cookie(): Promise<string> {
    return this.ctx
      .storageState()
      .then((s) => s.cookies.map((c) => `${c.name}=${c.value}`).join('; '));
  }

  async ws(cursor: number): Promise<Ws> {
    return Ws.open(await this.cookie(), cursor);
  }
}

/** WS client: collects poke, can wait for the next one. */
export class Ws {
  messages: Record<string, unknown>[] = [];
  private waiters: ((m: Record<string, unknown>) => void)[] = [];
  private constructor(public sock: WebSocket) {
    sock.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.messages.push(m);
      this.waiters.splice(0).forEach((w) => w(m));
    });
  }

  static open(cookie: string | undefined, cursor: number): Promise<Ws> {
    const sock = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`, {
      headers: { Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const ws = new Ws(sock);
    return new Promise((res, rej) => {
      sock.once('open', () => {
        sock.send(JSON.stringify({ t: 'hello', cursor }));
        res(ws);
      });
      sock.once('error', rej);
      sock.once('unexpected-response', (_, r) => rej(new Error(`ws: ${r.statusCode}`)));
    });
  }

  /** Next message after the call (or an error on timeout). */
  next(timeoutMs = 5000): Promise<Record<string, unknown>> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('ws: нет сообщения')), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(t);
        res(m);
      });
    });
  }

  close() {
    this.sock.close();
  }
}
