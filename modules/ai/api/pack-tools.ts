import { z } from 'zod';
import type { CoreServices } from '@planar/server-kit';
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

/** Tools of packs and event bindings for the MCP registry (apps/api/src/mcp/tools.ts); same logic as the REST controllers. */
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
      'Загрузить пакет harness (zip base64 или packKey каталога) в документы проекта. dryRun — только список расхождений со страницами, правленными вручную, без записи; resolve {pageKey: reset|keep|{merged}} разрешает расхождения',
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
  ];
}
