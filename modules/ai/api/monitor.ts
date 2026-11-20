// PLNRAPP-500: the monitor of the engines — task control (reap of lost runs, reconcile of statuses, CI runs) and
// harness processing (retro). A pass of an engine is a row of ai_engine_runs, its steps — ai_engine_events;
// both are kept 7 days. A manual pass (a workspace admin) aborts the running one: the running row becomes
// `aborted`, the pass sees it at its next step (check) and stops.
import { sql } from 'drizzle-orm';
import type { Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import type { EngineId } from '../shared/index.js';

type Exec = Pick<Q, 'execute'>;

/** history and the live log are kept this long */
export const ENGINE_KEEP_DAYS = 7;
/** a running pass silent this long is lost (the server restarted): failed by the sweep */
export const ENGINE_LOST_MIN = 30;

export class EngineAborted extends Error {
  constructor() {
    super('прервано ручным запуском');
  }
}

export interface Tracker {
  readonly id: string;
  /** a step: the live log and the pass's current action */
  step(
    text: string,
    o?: { projectId?: string | null; taskId?: string | null; level?: 'info' | 'action' | 'error' },
  ): Promise<void>;
  /** n more tasks / projects handled */
  count(n?: number): void;
  /** throws EngineAborted when a manual pass replaced this one */
  check(): Promise<void>;
}

export interface TrackOpts {
  engine: EngineId;
  job: string;
  projectId?: string | null;
  trigger: 'cron' | 'event' | 'manual';
  userId?: string | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 2000);

/**
 * Runs `fn` as a pass of the engine: the row is `running` while it works, then done / failed (the error text) /
 * aborted. An error of `fn` is thrown on (the job fails as before); an abort is not an error.
 */
export async function tracked(
  db: Exec,
  o: TrackOpts,
  fn: (t: Tracker) => Promise<void>,
): Promise<void> {
  const id = uuidv7();
  let processed = 0;
  await db.execute(
    sql`insert into ai_engine_runs (id, engine, job, project_id, trigger, user_id, state)
        values (${id}, ${o.engine}, ${o.job}, ${o.projectId ?? null}, ${o.trigger}, ${o.userId ?? null}, 'running')`,
  );
  const t: Tracker = {
    id,
    async step(text, s = {}) {
      const projectId = s.projectId ?? o.projectId ?? null;
      const line = text.slice(0, 2000);
      await db.execute(
        sql`insert into ai_engine_events (id, run_id, engine, project_id, task_id, level, text)
            values (${uuidv7()}, ${id}, ${o.engine}, ${projectId}, ${s.taskId ?? null}, ${s.level ?? 'info'}, ${line})`,
      );
      await db.execute(
        sql`update ai_engine_runs set current = ${line}, current_project_id = ${projectId},
            processed = ${processed}, updated_at = now() where id = ${id} and state = 'running'`,
      );
    },
    count(n = 1) {
      processed += n;
    },
    async check() {
      const r = await db.execute(sql`select state from ai_engine_runs where id = ${id}`);
      if (r.rows[0]?.state === 'aborted') throw new EngineAborted();
    },
  };
  const finish = (state: string, error: string | null) =>
    db.execute(
      sql`update ai_engine_runs set state = ${state}, error = ${error}, processed = ${processed},
          current = null, current_project_id = null, finished_at = now(), updated_at = now()
          where id = ${id} and state = 'running'`,
    );
  try {
    await fn(t);
  } catch (e) {
    if (e instanceof EngineAborted) {
      // the row is aborted already; the count of what was done before the abort is kept
      await db.execute(sql`update ai_engine_runs set processed = ${processed} where id = ${id}`);
      return;
    }
    await t
      .step(`ошибка: ${errText(e)}`, { level: 'error', projectId: o.projectId ?? null })
      .catch(() => {});
    await finish('failed', errText(e));
    throw e;
  }
  await finish('done', null);
}

/** Aborts the running passes of the engine (a manual start replaces them); the count of aborted. */
export async function abortRunning(db: Exec, engine: EngineId) {
  const r = await db.execute(
    sql`update ai_engine_runs set state = 'aborted', error = 'прервано ручным запуском',
        current = null, current_project_id = null, finished_at = now(), updated_at = now()
        where engine = ${engine} and state = 'running' returning id`,
  );
  for (const x of r.rows as { id: string }[])
    await db.execute(
      sql`insert into ai_engine_events (id, run_id, engine, level, text)
          values (${uuidv7()}, ${x.id}, ${engine}, 'info', 'прервано ручным запуском')`,
    );
  return r.rows.length;
}

/** Passes older than 7 days go (their events with them); a pass silent ENGINE_LOST_MIN — failed as lost. */
export async function sweep(db: Exec) {
  await db.execute(
    sql`delete from ai_engine_runs where started_at < now() - make_interval(days => ${ENGINE_KEEP_DAYS})`,
  );
  await db.execute(
    sql`update ai_engine_runs set state = 'failed', error = 'прервано: нет вестей от прохода (перезапуск сервера?)',
        current = null, current_project_id = null, finished_at = now()
        where state = 'running' and updated_at < now() - make_interval(mins => ${ENGINE_LOST_MIN})`,
  );
}
