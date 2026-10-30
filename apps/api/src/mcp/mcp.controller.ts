import { Controller, Delete, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_OPTS, authenticateRaw, type AuthOpts } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import { Public } from '../auth/public.js';
import type { Db } from '../db/index.js';
import { RestService } from '../rest/rest.service.js';
import { DB } from '../tokens.js';
import { buildMcpServer } from './tools.js';

/** Auth is its own here: Bearer only, cookie is not accepted. */
@Public()
@Controller('mcp')
export class McpController {
  constructor(
    @Inject(DB) private db: Db,
    @Inject(AUTH_OPTS) private opts: AuthOpts,
    @Inject(RestService) private rest: RestService,
  ) {}

  @Post()
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const ctx = /^Bearer /i.test(req.headers.authorization ?? '')
      ? await authenticateRaw(this.db, req.headers, req.method, this.opts)
      : null;
    if (ctx?.via !== 'token') throw new HttpError(401, 'unauthenticated', 'Нужен Bearer-токен');
    const server = buildMcpServer(this.rest, ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    reply.raw.on('close', () => void server.close());
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  }

  @Get()
  get(): never {
    throw new HttpError(405, 'invalid_request', 'Только POST');
  }

  @Delete()
  del(): never {
    throw new HttpError(405, 'invalid_request', 'Только POST');
  }
}
