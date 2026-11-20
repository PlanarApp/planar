import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, type CoreServices } from '@planar/server-kit';
import { eventsSchema } from '../shared/index.js';
import { applyPack, diffPack } from './harness-apply.js';
import {
  assertAiAdmin,
  conflictsOf,
  failPack,
  listCatalog,
  listProjectPacks,
  packFiles,
  setEvents,
  upload,
} from './packs.js';

/** Tools of packs, event bindings and task runs for the MCP registry (apps/api/src/mcp/tools.ts); same logic as the REST controllers. */
export interface PackTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  write: boolean;
  run(args: never, uid: string): Promise<unknown>;
}

const projectId = z.uuid();
const packKey = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);
const source = {
  projectId,
  packKey,
  // the app's bodyLimit is 1 MiB: a bigger zip never gets here
  zip: z
    .string()
    .max(1_000_000)
    .optional()
    .describe('zip пакета в base64; без него — пакет каталога'),
  title: z.string().min(1).max(200).optional(),
};

export function aiPackTools(core: CoreServices): PackTool[] {
  // admin of the project with the module on, then the body
  const def = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    write: boolean,
    f: (a: z.infer<z.ZodObject<S>>, uid: string) => Promise<unknown>,
  ): PackTool => ({
    name,
    description,
    shape,
    write,
    run: async (a, uid) => {
      await assertAiAdmin(core.db, uid, (a as { projectId: string }).projectId);
      try {
        return await f(a as never, uid);
      } catch (e) {
        failPack(e);
      }
    },
  });
  return [
    def(
      'ai_list_packs',
      'Каталог пакетов harness, загруженные в проект пакеты и привязки событий ИИ (только админ проекта)',
      { projectId },
      false,
      async (a) => ({
        catalog: await listCatalog(),
        ...(await listProjectPacks(core.db, core, a.projectId)),
      }),
    ),
    def(
      'ai_upload_pack',
      'Загрузить пакет harness (zip base64 или packKey каталога) в документы проекта. dryRun — только список расхождений со страницами, правленными вручную, без записи; resolve {pageKey: reset|keep|{merged}} — выбор для любой страницы (свои / каталог / объединённый текст)',
      {
        ...source,
        dryRun: z.boolean().optional(),
        resolve: z
          .record(
            z.string(),
            z.union([z.enum(['reset', 'keep']), z.object({ merged: z.string().max(200_000) })]),
          )
          .optional(),
      },
      true,
      async ({ dryRun, ...a }, uid) => {
        const files = await packFiles(a);
        if (dryRun) return { conflicts: (await conflictsOf(core.db, { ...a, files })).conflicts };
        return upload(core.db, core, uid, { ...a, files });
      },
    ),
    def(
      'ai_diff_pack',
      'Diff пакета (страница пакета в документах проекта) с проектом: операции и ошибки, ничего не пишет',
      {
        projectId,
        packPageId: z.uuid(),
        replaceWith: z.record(z.string(), z.string()).optional(),
      },
      false,
      async (a) => diffPack(core, a),
    ),
    def(
      'ai_apply_pack',
      'Применить пакет к проекту: статусы, метки, поля, действия, правила (diff пересчитывается; расхождение — ошибка conflict)',
      {
        projectId,
        packPageId: z.uuid(),
        replaceWith: z.record(z.string(), z.string()).optional(),
      },
      true,
      async (a, uid) => applyPack(core, uid, a),
    ),
    def(
      'ai_set_pack_events',
      'Привязки событий ИИ (comment, mention, checklist, chat) к действиям проекта; событие без привязки — встроенный промпт',
      { projectId, packKey, events: eventsSchema },
      true,
      async (a) => setEvents(core.db, a.projectId, a.packKey, a.events),
    ),
    {
      name: 'list_task_ai_runs',
      description:
        'Прогоны ИИ задачи (новые сверху, до 50): состояние, действие, попытка, время, причина ошибки. Видят админ проекта, автор и исполнители задачи',
      shape: { task: z.string().min(1).describe('uuid или ключ задачи, например ABC-123') },
      write: false,
      run: async (a: { task: string }, uid) => taskRuns(core, uid, a.task),
    },
  ];
}

/** PLNRAPP-658: the runs of a task — the access as GET api/ai/tasks/:taskId/runs (controller.ts seeTask). */
async function taskRuns(core: CoreServices, uid: string, task: string) {
  const byId = z.uuid().safeParse(task).success;
  const t = (
    await core.db.execute(
      sql`select t.id from tasks t join projects p on p.id = t.project_id
          where ${byId ? sql`t.id = ${task}::uuid` : sql`p.key || '-' || t.number = ${task.toUpperCase()}`}
            and 'ai' = any(p.modules) and project_role(${uid}::uuid, p.id) is not null
            and (project_role(${uid}::uuid, p.id) = 'admin' or t.created_by = ${uid}::uuid
              or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = ${uid}::uuid))`,
    )
  ).rows[0];
  if (!t) throw new HttpError(404, 'not_found', 'Не найдено');
  const r = await core.db.execute(
    sql`select r.id, r.kind, r.state, r.attempt, r.restart_of as "restartOf",
          (select a.name from ai_actions a where a.id = r.action_id) as action, r.cost,
          r.created_at as "createdAt", r.started_at as "startedAt", r.finished_at as "finishedAt",
          -- the reason of a failure is the last line of the log
          case when r.state = 'failed' then left(regexp_replace(rtrim(r.log, E'\n'), '^.*\n', ''), 500) end as error
        from ai_runs r where r.task_id = ${t.id as string}::uuid order by r.created_at desc, r.id desc limit 50`,
  );
  return { runs: r.rows };
}
