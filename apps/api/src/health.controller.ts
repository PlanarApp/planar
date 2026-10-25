import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from './auth/public.js';
import type { Db } from './db/index.js';
import { JobsService } from './jobs/jobs.js';
import { DB } from './tokens.js';

// тот же путь, что migrationsFolder в db/index.ts
const journal = fileURLToPath(new URL('../drizzle/meta/_journal.json', import.meta.url));

@Public()
@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

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

  /** GET /api/health/ready (C-ops-health v1) */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: FastifyReply) {
    const fail = (body: object) => {
      void res.status(503);
      return { ok: false, ...body };
    };
    let applied: number;
    try {
      await this.db.$client.query('select 1');
      // нет таблицы миграций — ничего не применено
      applied = Number(
        (await this.db.$client.query(`select to_regclass('drizzle.__drizzle_migrations') as t`))
          .rows[0].t
          ? (
              await this.db.$client.query(
                'select count(*)::int as n from drizzle.__drizzle_migrations',
              )
            ).rows[0].n
          : 0,
      );
    } catch {
      return fail({ db: 'down' });
    }
    let expected = 0;
    try {
      expected = (JSON.parse(readFileSync(journal, 'utf8')).entries as unknown[]).length;
    } catch {
      /* нет журнала (как в migrate()) — ждать нечего */
    }
    if (applied < expected) return fail({ db: 'up', migrations: 'pending' });
    let queue: 'up' | 'off' = 'off';
    if (this.jobs.enabled) {
      try {
        // живая проверка на каждой пробе, таймаут 2 с
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            this.jobs.start().then(() => this.db.$client.query('select 1 from pgboss.job limit 1')),
            new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), 2000))),
          ]);
        } finally {
          clearTimeout(timer);
        }
        queue = 'up';
      } catch {
        return fail({ db: 'up', migrations: 'ok', queue: 'down' });
      }
    }
    return { ok: true, db: 'up', migrations: 'ok', queue };
  }
}
