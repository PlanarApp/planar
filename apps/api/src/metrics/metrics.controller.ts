import { timingSafeEqual } from 'node:crypto';
import { Controller, Logger, Get, Headers, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/public.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../auth/errors.js';
import { JobsService } from '../jobs/jobs.js';
import { DB } from '../tokens.js';
import { render, type Snapshot } from './metrics.js';

@Public()
@Controller('api/metrics')
export class MetricsController {
  private readonly log = new Logger(MetricsController.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  @Get()
  async get(
    @Res({ passthrough: true }) res: FastifyReply,
    @Headers('authorization') auth?: string,
  ) {
    const token = process.env.METRICS_TOKEN;
    if (!token) throw new HttpError(404, 'not_found', 'Not found');
    const given = Buffer.from(auth?.startsWith('Bearer ') ? auth.slice(7) : '');
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want))
      throw new HttpError(401, 'unauthenticated', 'Unauthenticated');
    const snap: Snapshot = { queue: null, dbSize: null };
    // сбой запроса не роняет ответ: соответствующие строки пропускаются
    try {
      snap.dbSize = Number(
        (await this.db.execute(sql`select pg_database_size(current_database())::float8 as n`))
          .rows[0]!.n,
      );
    } catch (e) {
      this.log.warn(`planar_db_size_bytes пропущена: ${(e as Error).message}`);
    }
    if (this.jobs.enabled) {
      try {
        const r = await this.db.execute(
          sql`select name, state::text as state, count(*)::int as n from pgboss.job group by 1, 2`,
        );
        snap.queue = r.rows.map((x) => ({
          queue: String(x.name),
          state: String(x.state),
          n: Number(x.n),
        }));
      } catch (e) {
        this.log.warn(`planar_queue_jobs пропущена: ${(e as Error).message}`);
      }
    }
    void res.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return render(snap);
  }
}
