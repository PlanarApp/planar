import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from './auth/public.js';
import type { Db } from './db/index.js';
import { DB } from './tokens.js';

@Public()
@Controller('api/health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check(@Res({ passthrough: true }) res: FastifyReply) {
    try {
      await this.db.$client.query('select 1');
      return { ok: true, db: 'up' };
    } catch {
      void res.status(503);
      return { ok: false, db: 'down' };
    }
  }
}
