import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { distinctValues, suggestMapping, TRELLO_MAPPING } from '@planar/module-import/api';
import { importJobs } from '@planar/module-import/api/schema';
import { FORMATS, mappingSchema, MAX_BYTES, PRESETS } from '@planar/module-import/shared';
import { uuidv7 } from '@planar/shared';
import { HttpError } from '../../auth/errors.js';
import type { ExtArea, ExtOp } from './types.js';
import { requireAdmin } from './instance.service.js';
import {
  D,
  S,
  deliveryOut,
  isUuid,
  newDelivery,
  newSecret,
  notFound,
  subOut,
  subRow,
  parseImport,
  type ImportInput,
} from './integrations.service.js';

// PLNRAPP-279 (part 1): automation runs, webhooks (instance admin only, the secret is never returned) and import job status
const id = z.uuid();
const url = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'нужен http(s)-адрес без логина и пароля');
const events = z.array(z.string().min(1).max(100)).min(1).max(20);
const description = z.string().max(500).nullish();

const importFile = {
  format: z.enum(FORMATS),
  preset: z.enum(PRESETS),
  content: z
    .string()
    .min(1)
    .max(MAX_BYTES)
    .describe('содержимое файла текстом: CSV или JSON-экспорт Trello'),
  mapping: mappingSchema
    .optional()
    .describe("сопоставление колонок; значение 'new' не поддерживается"),
};

const ops: ExtOp[] = [
  {
    tool: 'list_automation_runs',
    description:
      'Журнал запусков правила автоматизации (новые сверху): статус, задача, глубина, ошибка; limit 1–200, по умолчанию 50',
    method: 'get',
    path: '/api/v1/automations/rules/{id}/runs',
    shape: { id, limit: z.coerce.number().int().min(1).max(200).optional() },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string; limit?: number };
      const gone = notFound('Правило');
      if (!isUuid(a.id)) throw gone;
      const q = async (s: ReturnType<typeof sql>) =>
        (await d.db.execute(s)).rows as Record<string, unknown>[];
      const visible = await q(
        sql`select r.project_id as "projectId" from automations_rules r
            where r.id = ${a.id} and can_see_space(${u}::uuid, r.space_id)`,
      );
      if (!visible.length) throw gone;
      const on = await q(
        sql`select 'automations' = any(modules) as on from projects where id = ${visible[0]!.projectId as string}::uuid`,
      );
      if (on[0] && !on[0].on)
        throw new HttpError(404, 'module_disabled', 'Модуль automations выключен в проекте');
      return q(
        sql`select id, rule_id as "ruleId", task_id as "taskId", depth, status, error, created_at as "createdAt"
            from automations_runs where rule_id = ${a.id} order by created_at desc, id desc limit ${a.limit ?? 50}`,
      );
    },
  },
  {
    tool: 'list_webhooks',
    description: 'Подписки на вебхуки инстанса (только админ инстанса); секрет не показывается',
    method: 'get',
    path: '/api/v1/webhooks/subscriptions',
    shape: {},
    write: false,
    run: async (d, u) => {
      await requireAdmin(d, u);
      return (await d.db.select().from(S).orderBy(desc(S.createdAt), desc(S.id))).map(subOut);
    },
  },
  {
    tool: 'create_webhook',
    description:
      'Создать подписку на вебхуки (только админ инстанса): http(s)-адрес, список событий, описание. Секрет подписи создаётся и не возвращается',
    method: 'post',
    path: '/api/v1/webhooks/subscriptions',
    shape: { url, events, description },
    write: true,
    danger: 'delete', // admin power: the AI chat asks the user's «yes» (prompt injection)
    status: 201,
    run: async (d, u, i) => {
      await requireAdmin(d, u);
      const b = i as { url: string; events: string[]; description?: string | null };
      const [r] = await d.db
        .insert(S)
        .values({
          id: uuidv7(),
          url: b.url,
          events: b.events,
          secret: newSecret(),
          active: true,
          description: b.description ?? null,
          createdBy: u,
        })
        .returning();
      return subOut(r!);
    },
  },
  {
    tool: 'update_webhook',
    description:
      'Изменить подписку на вебхуки (только админ инстанса): адрес, события, активность, описание',
    method: 'patch',
    path: '/api/v1/webhooks/subscriptions/{id}',
    shape: {
      id,
      url: url.optional(),
      events: events.optional(),
      active: z.boolean().optional(),
      description,
    },
    write: true,
    danger: 'delete', // admin power: the AI chat asks the user's «yes» (prompt injection)
    run: async (d, u, i) => {
      await requireAdmin(d, u);
      const { id: sid, ...b } = i as { id: string };
      await subRow(d, sid);
      const [r] = await d.db
        .update(S)
        .set({ ...b, updatedAt: new Date().toISOString() })
        .where(eq(S.id, sid))
        .returning();
      return subOut(r!);
    },
  },
  {
    tool: 'delete_webhook',
    description: 'Удалить подписку на вебхуки вместе с историей доставок (только админ инстанса)',
    method: 'delete',
    path: '/api/v1/webhooks/subscriptions/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i) => {
      await requireAdmin(d, u);
      const sid = (i as { id: string }).id;
      await subRow(d, sid);
      await d.db.delete(S).where(eq(S.id, sid));
      return undefined;
    },
  },
  {
    tool: 'ping_webhook',
    description:
      'Отправить тестовое событие ping на подписку (только админ инстанса): создаёт доставку, отправка — фоновым заданием',
    method: 'post',
    path: '/api/v1/webhooks/subscriptions/{id}/ping',
    shape: { id },
    write: true,
    run: async (d, u, i) => {
      await requireAdmin(d, u);
      const sid = (i as { id: string }).id;
      await subRow(d, sid);
      return deliveryOut(await newDelivery(d, sid, 'ping', {}));
    },
  },
  {
    tool: 'list_webhook_deliveries',
    description:
      'Доставки подписки, новые сверху (только админ инстанса): статус, попытки, ошибка; limit 1–200 (50), cursor из nextCursor',
    method: 'get',
    path: '/api/v1/webhooks/subscriptions/{id}/deliveries',
    shape: {
      id,
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().max(500).optional(),
    },
    write: false,
    run: async (d, u, i) => {
      await requireAdmin(d, u);
      const a = i as { id: string; limit?: number; cursor?: string };
      await subRow(d, a.id);
      const limit = a.limit ?? 50;
      let after;
      if (a.cursor) {
        try {
          const [c, ci] = z
            .tuple([z.string(), z.uuid()])
            .parse(JSON.parse(Buffer.from(a.cursor, 'base64url').toString()));
          after = sql`(${D.createdAt}, ${D.id}) < (${c}::timestamptz, ${ci}::uuid)`;
        } catch {
          throw new HttpError(400, 'invalid_request', 'Неверный cursor');
        }
      }
      const rows = await d.db
        .select()
        .from(D)
        .where(and(eq(D.subscriptionId, a.id), after))
        .orderBy(desc(D.createdAt), desc(D.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        data: page.map(deliveryOut),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url')
            : null,
      };
    },
  },
  {
    tool: 'redeliver_webhook',
    description:
      'Повторить доставку (только админ инстанса): создаёт новую доставку с тем же событием и данными',
    method: 'post',
    path: '/api/v1/webhooks/deliveries/{id}/redeliver',
    shape: { id },
    write: true,
    run: async (d, u, i) => {
      await requireAdmin(d, u);
      const did = (i as { id: string }).id;
      const [old] = isUuid(did) ? await d.db.select().from(D).where(eq(D.id, did)) : [];
      if (!old) throw notFound('Доставка');
      return deliveryOut(await newDelivery(d, old.subscriptionId, old.event, old.payload));
    },
  },
  {
    tool: 'preview_import',
    description:
      "Предпросмотр импорта задач из CSV или Trello (ничего не создаёт): колонки, первые 20 строк, предложенное сопоставление и значения для сопоставления. Файл передаётся текстом в content. Создание проектов и пользователей ('new') через MCP не поддерживается",
    method: 'post',
    path: '/api/v1/import/preview',
    shape: importFile,
    write: false,
    run: async (_d, _u, i) => {
      const a = i as ImportInput;
      const mapping = a.format === 'csv' ? (a.mapping ?? null) : null;
      const p = parseImport(a.content, a.format, mapping, a.preset);
      return {
        columns: p.columns,
        rows: p.rows.slice(0, 20),
        mapping:
          mapping ?? (a.format === 'trello' ? TRELLO_MAPPING : suggestMapping(p.columns, a.preset)),
        values: distinctValues(p.items),
      };
    },
  },
  {
    tool: 'start_import',
    description:
      "Запустить импорт задач из CSV или Trello в проект (projectId) или в пространство по колонке проекта (spaceId); нужна роль не ниже участника. Файл — текстом в content, mapping обязателен для CSV. Статус — get_import_job. Создание проектов и пользователей ('new') через MCP не поддерживается",
    method: 'post',
    path: '/api/v1/import/jobs',
    shape: { ...importFile, projectId: id.optional(), spaceId: id.optional() },
    write: true,
    status: 201,
    run: async (d, u, i) => {
      const a = i as ImportInput & { projectId?: string; spaceId?: string };
      const bad = (m: string) => new HttpError(400, 'invalid_request', m);
      const mapping = a.mapping ?? (a.format === 'trello' ? TRELLO_MAPPING : undefined);
      if (!mapping) throw bad('mapping неверен');
      if (!a.projectId && !a.spaceId) throw bad('нужен projectId или spaceId');
      if (!a.projectId && !mapping.project) throw bad('без проекта нужна колонка проекта');
      if (
        [
          ...Object.values(mapping.projectMap ?? {}),
          ...Object.values(mapping.userMap ?? {}),
        ].includes('new')
      )
        throw bad("значение 'new' в projectMap/userMap через MCP не поддерживается");
      const ok = await d.db.execute(
        a.projectId
          ? sql`
        select p.space_id from projects p
        where p.id = ${a.projectId} and project_role(${u}::uuid, p.id) in ('admin', 'member')`
          : sql`
        select s.id as space_id from spaces s where s.id = ${a.spaceId} and (
          exists (select 1 from space_members m where m.space_id = s.id and m.user_id = ${u}
            and m.role in ('admin', 'member'))
          or exists (select 1 from users x where x.id = ${u}::uuid and x.role in ('owner', 'admin')))`,
      );
      if (!ok.rows.length) throw notFound(a.projectId ? 'Проект' : 'Пространство');
      const spaceId = (ok.rows[0] as { space_id: string }).space_id;
      for (const pid of new Set(Object.values(mapping.projectMap ?? {}))) {
        const r = await d.db.execute(sql`
          select 1 from projects p where p.id = ${pid} and p.space_id = ${spaceId} and p.archived_at is null
            and project_role(${u}::uuid, p.id) in ('admin', 'member')`);
        if (!r.rows.length) throw bad('projectMap: проект не найден');
      }
      const p = parseImport(a.content, a.format, mapping, a.preset);
      const [row] = await d.db
        .insert(importJobs)
        .values({
          id: uuidv7(),
          userId: u,
          projectId: a.projectId ?? null,
          spaceId,
          format: a.format,
          preset: a.preset,
          total: p.items.length,
          source: a.content,
          mapping,
        })
        .returning();
      // enqueue is not in ExtDeps: import.sweep picks the pending job up
      return { ...row!, source: undefined, mapping: undefined };
    },
  },
  {
    tool: 'get_import_job',
    description:
      'Статус задания импорта (только своего): статус, всего/обработано/создано/обновлено, пропущенные строки, предупреждения, ошибка',
    method: 'get',
    path: '/api/v1/import/jobs/{id}',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const jid = (i as { id: string }).id;
      const [row] = isUuid(jid)
        ? await d.db
            .select()
            .from(importJobs)
            .where(and(eq(importJobs.id, jid), eq(importJobs.userId, u)))
        : [];
      if (!row) throw notFound('Импорт');
      return { ...row, source: undefined, mapping: undefined };
    },
  },
];

export const area: ExtArea = { name: 'integrations', ops };
