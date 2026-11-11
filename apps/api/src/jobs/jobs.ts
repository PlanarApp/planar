import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import type { Db } from '../db/index.js';
import type { JobApi, JobDef, JobOpts } from '../modules/hooks.js';
import { enabledModules } from '../modules/enabled.js';
import { installed } from '../modules/installed.js';
import type { PushOpts, PushQueue } from '../push/push.js';
import { executeMutations } from '../sync/mutate.js';
import type { Q } from '../sync/server-tx.js';
import { DB } from '../tokens.js';
import { ensureSystemUser } from '../users/system.js';
import { archivePurge } from './archive.js';
import { DUE_CRON, DUE_QUEUE, remindDue } from './due.js';

export const PUSH_OPTS = Symbol('PUSH_OPTS');

/** One PgBoss per process (push + module jobs). */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private log = new Logger('jobs');
  private ready?: Promise<PgBoss | undefined>;
  private sysId?: Promise<string>;
  private boss?: PgBoss;
  /** notification delivery after COMMIT of mutations from jobs (enqueued by PushQueue) */
  push?: PushQueue;

  constructor(
    @Inject(DB) private db: Db,
    @Inject(PUSH_OPTS) private opts: PushOpts,
  ) {}

  get enabled(): boolean {
    return !!this.opts.boss;
  }

  systemUserId(): Promise<string> {
    return (this.sysId ??= ensureSystemUser(this.db).catch((e) => {
      this.sysId = undefined;
      throw e;
    }));
  }

  /** Start (lazy, once); boss:false → undefined. */
  start(): Promise<PgBoss | undefined> {
    if (!this.opts.boss) return Promise.resolve(undefined);
    return (this.ready ??= (async () => {
      const boss = new PgBoss({ connectionString: this.opts.databaseUrl, max: 2 });
      boss.on('error', (e) => this.log.error(e));
      await boss.start();
      if (this.opts.worker !== false) {
        await this.register(boss, null, archivePurge);
        await this.register(boss, null, {
          queue: DUE_QUEUE,
          cron: DUE_CRON,
          handler: async (_, api) => this.push?.enqueue(await remindDue(this.db, api.systemUserId)),
        });
        for (const m of installed)
          for (const j of (m.api.jobs ?? []) as JobDef[]) await this.register(boss, m.api.id, j);
      }
      this.boss = boss;
      return boss;
    })().catch((e) => {
      this.ready = undefined; // the next call will retry
      throw e;
    }));
  }

  /** moduleId null — a core job. */
  private async register(boss: PgBoss, moduleId: string | null, j: JobDef) {
    const { retryLimit, retryDelay, retryBackoff, expireInSeconds } = j;
    // pg-boss does not accept undefined keys
    const qo = Object.fromEntries(
      Object.entries({ retryLimit, retryDelay, retryBackoff, expireInSeconds }).filter(
        ([, v]) => v !== undefined,
      ),
    );
    await boss.createQueue(j.queue, qo);
    await boss.work<Record<string, unknown>>(
      j.queue,
      { pollingIntervalSeconds: 0.5, localConcurrency: j.localConcurrency ?? 1 },
      async (jobs) => {
        // disabled module: the job finishes without a handler
        if (moduleId && !(await enabledModules(this.db)).has(moduleId)) return;
        const api = await this.api();
        for (const job of jobs) await j.handler(job.data, api);
      },
    );
    if (j.cron) await boss.schedule(j.queue, j.cron, {}, { tz: 'UTC' });
  }

  async api(): Promise<JobApi> {
    return {
      db: this.db,
      systemUserId: await this.systemUserId(),
      execute: (userId, muts, o) =>
        executeMutations(this.db, userId, muts, this.push, undefined, o),
      enqueue: (queue, data, o) => this.enqueue(queue, data, o),
    };
  }

  /** Outside a transaction; boss:false — no-op. */
  async enqueue(queue: string, data: object, o?: JobOpts, q?: Q): Promise<void> {
    const boss = await this.start();
    if (!boss) return;
    const { upsert, ...opts } = o ?? {};
    const sendOpts = {
      ...opts,
      ...(q && { db: { executeSql: (text: string, values?: unknown[]) => run(q, text, values) } }),
    };
    if (upsert) await boss.upsert(queue, data, sendOpts);
    else await boss.send(queue, data, sendOpts);
  }

  private stopped?: Promise<void>;
  onApplicationShutdown(): Promise<void> {
    return (this.stopped ??= (async () => {
      await this.ready?.catch(() => {});
      await this.boss?.stop({ graceful: true, timeout: 5000 });
    })());
  }
}

/** pg-boss SQL (`$n` parameters) via a Drizzle transaction. */
async function run(q: Q, text: string, values: unknown[] = []) {
  const parts = text.split(/\$(\d+)/);
  const chunks = parts.map((p, i) => (i % 2 ? sql.param(values[Number(p) - 1]) : sql.raw(p)));
  const r = await q.execute(sql.join(chunks, sql.raw('')));
  return { rows: r.rows };
}
