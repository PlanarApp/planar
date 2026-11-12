// ai10: the container's calls — result, heartbeat, LLM proxy. No cookie session: the one-time secret of the run.
import {
  All,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  SetMetadata,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ServerResponse } from 'node:http';
import { once } from 'node:events';
import { CORE, HttpError, parseBody, type CoreServices, type JobApi } from '@planar/server-kit';
import { resolveConnection, secretOf } from './connections.js';
import { costOf } from './llm.js';
import { blocked, loadTask, overBudget, resultSchema, failed } from './run.js';
import { finishAgent, runBySecret, stopAgent } from './agent.js';

// same as core's @Public() (apps/api/src/auth/public.ts): the module does not import apps/api
const Public = () => SetMetadata('planar:public', true);

type Headers_ = Record<string, string | string[] | undefined>;
const ALLOWED = new Set(['/v1/messages', '/v1/chat/completions']);
const DEFAULT_BASE = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
};

/** x-api-key or Authorization: Bearer */
const secretOfRequest = (h: Headers_) => {
  const key = h['x-api-key'];
  return (
    (typeof key === 'string' && key) || /^Bearer (.+)$/.exec((h.authorization as string) ?? '')?.[1]
  );
};

/** Tokens out of a provider answer: OpenAI usage.prompt/completion_tokens, Anthropic usage.input/output_tokens (message_start, message_delta). */
function takeUsage(o: unknown, u: { in: number; out: number }) {
  const x =
    (o as { usage?: Record<string, unknown>; message?: { usage?: Record<string, unknown> } } | null)
      ?.usage ?? (o as { message?: { usage?: Record<string, unknown> } } | null)?.message?.usage;
  if (!x) return;
  const i = x.prompt_tokens ?? x.input_tokens;
  const t = x.completion_tokens ?? x.output_tokens;
  if (typeof i === 'number') u.in = i;
  if (typeof t === 'number') u.out = t;
}

@Public()
@Controller('api/ai')
export class AgentController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private api(): JobApi {
    const c = this.core;
    return {
      db: c.db,
      execute: (...a) => c.execute(...a),
      enqueue: (...a) => c.enqueue(...a),
      systemUserId: c.systemUserId(),
    };
  }

  /** Secret of the run → the run; wrong — 401, not running — 409. */
  private async auth(id: string, h: Headers_) {
    const r = await runBySecret(this.core.db, id, secretOfRequest(h));
    if (!r) throw new HttpError(401, 'unauthenticated', 'Неверный секрет прогона');
    if (r.state !== 'running') throw new HttpError(409, 'conflict', 'Прогон не выполняется');
    return r;
  }

  @Post('runs/:id')
  @HttpCode(200)
  async result(@Param('id') id: string, @Headers() h: Headers_, @Body() body: unknown) {
    await this.auth(id, h);
    // absent fields of the contract are null, as in the llm result
    const r = {
      ...failed(''),
      ...parseBody(resultSchema.partial().required({ verdict: true, comment: true }), body),
    };
    await finishAgent(this.api(), id, r as never);
    // the container exits itself; best effort, not awaited
    void stopAgent(this.core.db, id);
    return { ok: true };
  }

  @Post('runs/:id/heartbeat')
  @HttpCode(204)
  async heartbeat(@Param('id') id: string, @Headers() h: Headers_) {
    await this.auth(id, h);
    await this.core.db.execute(sql`update ai_runs set heartbeat_at = now() where id = ${id}::uuid`);
  }

  @All('llm/:runId/*')
  async llm(
    @Param('runId') runId: string,
    @Headers() h: Headers_,
    @Req() req: { url: string; body: unknown },
    @Res() reply: { hijack(): void; raw: ServerResponse },
  ) {
    const run = await this.auth(runId, h);
    const m = /^\/api\/ai\/llm\/[^/]+(\/[^?]*)(\?.*)?$/.exec(req.url);
    const path = m?.[1]?.replace(/\/+$/, '');
    if (!path || !ALLOWED.has(path)) throw new HttpError(404, 'not_found', 'Не найдено');
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object')
      throw new HttpError(400, 'invalid_request', 'Нужно тело JSON');
    const db = this.core.db;
    const task = (await db.execute(sql`select task_id as t from ai_runs where id = ${runId}::uuid`))
      .rows[0]!.t as string;
    const stop =
      (await blocked(db, run.projectId)) ?? (await overBudget(db, (await loadTask(db, task))!));
    if (stop) throw new HttpError(429, 'rate_limited', stop);
    const row = await resolveConnection(db, run.projectId);
    if (!row) throw new HttpError(502, 'unavailable', 'Нет подключения к ИИ');
    const conn = secretOf(row);
    const anthropic = conn.provider === 'anthropic';
    const base = (
      conn.baseUrl ?? (anthropic ? DEFAULT_BASE.anthropic : DEFAULT_BASE.openai)
    ).replace(/\/+$/, '');
    // baseUrl is the SDK's base (usually with /v1): the path is appended to it the same way
    const url = `${base}${path.replace(/^\/v1/, '')}${m![2] ?? ''}`;
    // a streamed OpenAI answer carries usage only on request
    if (body.stream && !anthropic && path === '/v1/chat/completions')
      body.stream_options = { ...(body.stream_options as object), include_usage: true };
    const ac = new AbortController();
    reply.raw.on('close', () => ac.abort());
    const up = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(anthropic
          ? {
              'x-api-key': conn.apiKey,
              'anthropic-version': (h['anthropic-version'] as string) ?? '2023-06-01',
              ...(h['anthropic-beta'] ? { 'anthropic-beta': h['anthropic-beta'] as string } : {}),
            }
          : { authorization: `Bearer ${conn.apiKey}` }),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).catch(() => null);
    if (!up) throw new HttpError(502, 'unavailable', 'Провайдер недоступен');
    const type = up.headers.get('content-type') ?? 'application/json';
    reply.hijack();
    reply.raw.writeHead(up.status, { 'content-type': type });
    const u = { in: 0, out: 0 };
    const sse = type.includes('text/event-stream');
    const dec = new TextDecoder();
    let buf = '';
    // shortcut: a non-stream answer is kept whole (≤ 16 MB), no usage if larger; when providers send bigger ones
    try {
      for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) {
        if (!reply.raw.write(chunk)) await once(reply.raw, 'drain');
        buf += dec.decode(chunk, { stream: true });
        if (!sse) {
          if (buf.length > 16e6) buf = '';
          continue;
        }
        const lines = buf.split('\n');
        buf = lines.pop()!;
        for (const l of lines)
          if (l.startsWith('data:'))
            try {
              takeUsage(JSON.parse(l.slice(5)), u);
            } catch {
              // [DONE] and the like
            }
      }
    } catch {
      // the container or the provider went away: what was counted is kept
    }
    // the answer ends only after the usage is written: the client sees the counted run
    try {
      if (!sse)
        try {
          takeUsage(JSON.parse(buf), u);
        } catch {
          // an error body
        }
      if (!u.in && !u.out) {
        await db.execute(
          sql`update ai_runs set log = log || ${`llm-прокси: usage не получен (${up.status})\n`} where id = ${runId}::uuid`,
        );
        return;
      }
      const cost = costOf(conn, u.in, u.out);
      await db.execute(
        sql`update ai_runs set input_tokens = input_tokens + ${u.in}, output_tokens = output_tokens + ${u.out},
            cost = case when ${cost}::float8 is null then cost else coalesce(cost, 0) + ${cost}::float8 end,
            updated_at = now() where id = ${runId}::uuid`,
      );
    } finally {
      reply.raw.end();
    }
  }
}
