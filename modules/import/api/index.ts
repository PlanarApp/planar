import { Controller, Get, HttpCode, Inject, Module, Param, Post, Req } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { CORE, HttpError, type CoreServices, type JobApi } from '@planar/server-kit';
import { uuidv7, type BackendModuleManifest } from '@planar/shared';
import {
  FORMATS,
  MAX_BYTES,
  MAX_ROWS,
  PRESETS,
  mappingSchema,
  shared,
  type ImportFormat,
  type ImportPreset,
  type Mapping,
  type Preview,
} from '../shared/index.js';
import { ParseError, TRELLO_MAPPING, parseSource, suggestMapping, type Item } from './parse.js';
import { importJobs, type RowNote, type RowWarning } from './schema.js';

// минимум от fastify-запроса с @fastify/multipart (fastify не зависимость модуля)
interface FastifyRequest {
  isMultipart(): boolean;
  parts(o: {
    limits: { fileSize: number };
  }): AsyncIterable<
    | { type: 'file'; fieldname: string; file: { resume(): void }; toBuffer(): Promise<Buffer> }
    | { type: 'field'; fieldname: string; value: unknown }
  >;
}

const bad = (m: string) => new HttpError(400, 'invalid_request', m);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Поля и файл multipart; файл ≤ 10 МБ, иначе 400. */
async function readForm(req: FastifyRequest) {
  if (!req.isMultipart()) throw bad('Ожидается multipart/form-data');
  const fields: Record<string, string> = {};
  let file: Buffer | undefined;
  try {
    for await (const part of req.parts({ limits: { fileSize: MAX_BYTES } })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) {
          part.file.resume();
          throw bad('Нужно ровно одно поле file');
        }
        file = await part.toBuffer();
      } else fields[part.fieldname] = String(part.value);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // RequestFileTooLargeError и прочие FST_* — ошибка клиента
    if ((e as { statusCode?: number }).statusCode)
      throw bad('Файл слишком большой или multipart некорректен');
    throw e;
  }
  if (!file) throw bad('Нужно поле file');
  return { fields, file: file.toString('utf8') };
}

function formatPreset(f: Record<string, string>): [ImportFormat, ImportPreset] {
  const format = f.format as ImportFormat;
  const preset = f.preset as ImportPreset;
  if (!FORMATS.includes(format) || !PRESETS.includes(preset)) throw bad('format/preset неверны');
  if ((format === 'trello') !== (preset === 'trello')) throw bad('preset не подходит формату');
  return [format, preset];
}

function parseOrThrow(...a: Parameters<typeof parseSource>) {
  try {
    const p = parseSource(...a);
    if (p.items.length > MAX_ROWS) throw new ParseError(`Больше ${MAX_ROWS} строк`);
    return p;
  } catch (e) {
    if (e instanceof ParseError) throw bad(e.message);
    throw e;
  }
}

const publicJob = (r: typeof importJobs.$inferSelect) => ({
  ...r,
  source: undefined,
  mapping: undefined,
});

@Controller('api/import')
class ImportController {
  constructor(@Inject(CORE) private readonly core: CoreServices) {}

  @Post('preview')
  @HttpCode(200)
  async preview(@Req() req: FastifyRequest): Promise<Preview> {
    this.core.auth(req);
    const { fields, file } = await readForm(req);
    const [format, preset] = formatPreset(fields);
    const p = parseOrThrow(file, format, null, preset);
    return {
      columns: p.columns,
      rows: p.rows.slice(0, 20),
      mapping: format === 'trello' ? TRELLO_MAPPING : suggestMapping(p.columns, preset),
    };
  }

  @Post('jobs')
  @HttpCode(202)
  async create(@Req() req: FastifyRequest) {
    const { userId } = this.core.auth(req);
    const { fields, file } = await readForm(req);
    const [format, preset] = formatPreset(fields);
    let mapping: Mapping;
    try {
      mapping =
        format === 'trello' && !fields.mapping
          ? TRELLO_MAPPING
          : mappingSchema.parse(JSON.parse(fields.mapping ?? ''));
    } catch {
      throw bad('mapping неверен');
    }
    if (!UUID.test(fields.projectId ?? '')) throw bad('projectId неверен');
    const projectId = fields.projectId!;
    // писать в проект может участник пространства с ролью не ниже member; чужой проект — как несуществующий
    const ok = await this.core.db.execute(sql`
      select 1 from projects p join space_members m on m.space_id = p.space_id
      where p.id = ${projectId} and m.user_id = ${userId} and m.role in ('admin', 'member')`);
    if (!ok.rows.length) throw new HttpError(404, 'not_found', 'Проект не найден');
    const p = parseOrThrow(file, format, mapping, preset);
    const [row] = await this.core.db
      .insert(importJobs)
      .values({
        id: uuidv7(),
        userId,
        projectId,
        format,
        preset,
        total: p.items.length,
        source: file,
        mapping,
      })
      .returning();
    // сразу в очередь; import.sweep остаётся страховкой
    await this.core.enqueue('import.run', { jobId: row!.id }, { singletonKey: row!.id });
    return { data: publicJob(row!) };
  }

  @Get('jobs/:id')
  async get(@Req() req: FastifyRequest, @Param('id') id: string) {
    const { userId } = this.core.auth(req);
    const [row] = UUID.test(id)
      ? await this.core.db
          .select()
          .from(importJobs)
          .where(and(eq(importJobs.id, id), eq(importJobs.userId, userId)))
      : [];
    if (!row) throw new HttpError(404, 'not_found', 'Импорт не найден');
    return { data: publicJob(row) };
  }
}

@Module({ controllers: [ImportController] })
class ImportModule {}

// ---------- фоновый импорт ----------

const BATCH = 100;
const LABEL_COLOR = '#6b7280';
const docOf = (text: string) => ({
  type: 'doc',
  content: text
    .split(/\r?\n/)
    .map((l) =>
      l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' },
    ),
});

type Mut = { name: string; args: unknown };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runImport(jobId: string, api: JobApi) {
  const db = api.db;
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  const touch = (set: Partial<typeof importJobs.$inferInsert>) =>
    db
      .update(importJobs)
      .set({ ...set, updatedAt: sql`now()` as never })
      .where(eq(importJobs.id, jobId));
  const skipped: RowNote[] = [];
  const warnings: RowWarning[] = [];
  let created = 0;
  let updated = 0;
  let processed = 0;
  try {
    const mapping = job!.mapping as Mapping;
    const { items } = parseSource(
      job!.source ?? '',
      job!.format as ImportFormat,
      mapping,
      job!.preset as ImportPreset,
    );
    await touch({ total: items.length });

    const q = <T>(s: ReturnType<typeof sql>) => db.execute(s).then((r) => r.rows as T[]);
    const [project] = await q<{ space_id: string }>(
      sql`select space_id from projects where id = ${job!.projectId}`,
    );
    if (!project) throw new Error('Проект не найден');
    const spaceId = project.space_id;
    const statuses = await q<{ id: string; category: string }>(
      sql`select id, category from statuses where space_id = ${spaceId} order by rank`,
    );
    const defaultStatus = (
      statuses.find((s) => s.category === 'todo') ?? statuses.find((s) => s.category === 'backlog')
    )?.id;
    if (!defaultStatus) throw new Error('Нет статуса по умолчанию');
    const statusMap = new Map(Object.entries(mapping.statusMap ?? {}));

    const users = new Map<string, string>();
    for (const u of await q<{ id: string; login: string; email: string | null }>(sql`
      select u.id, u.login, u.email from users u join space_members m on m.user_id = u.id
      where m.space_id = ${spaceId} and u.deactivated_at is null`)) {
      users.set(u.login.toLowerCase(), u.id);
    }
    // email важнее login: перезаписывает при совпадении строк
    for (const u of await q<{ id: string; email: string }>(sql`
      select u.id, u.email from users u join space_members m on m.user_id = u.id
      where m.space_id = ${spaceId} and u.deactivated_at is null and u.email is not null`)) {
      users.set(u.email.toLowerCase(), u.id);
    }

    // метки по имени без регистра; недостающие создаются одним вызовом
    const labels = new Map<string, string>();
    for (const l of await q<{ id: string; name: string }>(
      sql`select id, name from labels where space_id = ${spaceId}`,
    ))
      labels.set(l.name.toLowerCase(), l.id);
    const make: Mut[] = [];
    for (const it of items) {
      if (it.skip) continue;
      for (const n of (it.labels ?? []).map((x) => x.slice(0, 100))) {
        if (labels.has(n.toLowerCase())) continue;
        const id = uuidv7();
        labels.set(n.toLowerCase(), id);
        make.push({ name: 'label.create', args: { id, spaceId, name: n, color: LABEL_COLOR } });
      }
    }
    for (let i = 0; i < make.length; i += BATCH)
      await api.execute(job!.userId, make.slice(i, i + BATCH));

    // внешний ID → задача (ранее импортированные, ещё существующие)
    const known = new Map<string, string>();
    for (const r of await q<{ external_id: string; task_id: string }>(sql`
      select i.external_id, i.task_id from import_items i join tasks t on t.id = i.task_id
      where i.project_id = ${job!.projectId} and i.preset = ${job!.preset}`))
      known.set(r.external_id, r.task_id);
    const exists = new Set(known.values());

    // родители раньше детей; цикл или неизвестный родитель — без родителя
    const byExt = new Map<string, number>();
    items.forEach((it, i) => {
      if (it.externalId && !it.skip && !byExt.has(it.externalId)) byExt.set(it.externalId, i);
    });
    const order: number[] = [];
    const state: number[] = []; // 1 — в пути, 2 — размещена
    const place = (i: number) => {
      if (state[i]) return;
      state[i] = 1;
      const p = items[i]!.parentExt;
      const pi = p === undefined ? undefined : byExt.get(p);
      if (pi !== undefined && pi !== i) {
        if (state[pi] === 1) {
          items[i]!.parentExt = undefined;
          items[i]!.notes.push('цикл родителей: родитель не назначен');
        } else place(pi);
      }
      state[i] = 2;
      order.push(i);
    };
    items.forEach((_, i) => place(i));

    // id задач заранее; повтор externalId в файле — обновление первой
    const taskOf = new Map(known);
    const fresh = new Set<string>(); // externalId, созданные этим запуском
    // последний ключ по статусу: новые задачи встают после существующих
    const lastRank = new Map<string, string | null>();
    const nextRank = async (statusId: string) => {
      if (!lastRank.has(statusId)) {
        const r = await q<{ m: string | null }>(
          sql`select max(rank collate "C") as m from tasks where status_id = ${statusId}`,
        );
        lastRank.set(statusId, r[0]?.m ?? null);
      }
      const k = generateKeyBetween(lastRank.get(statusId)!, null);
      lastRank.set(statusId, k);
      return k;
    };

    const buildRow = async (
      it: Item,
    ): Promise<{
      muts: Mut[];
      kind: 'created' | 'updated';
      attach?: { ext: string; taskId: string };
      notes: string[];
    }> => {
      const notes = [...it.notes];
      const statusId =
        it.status === undefined ? undefined : (statusMap.get(it.status) ?? defaultStatus);
      const assigneeIds: string[] = [];
      for (const a of it.assignees ?? []) {
        const id = users.get(a.toLowerCase());
        if (id) {
          if (!assigneeIds.includes(id)) assigneeIds.push(id);
        } else notes.push(`исполнитель «${a}» не найден`);
      }
      const labelIds = [
        ...new Set((it.labels ?? []).map((n) => labels.get(n.slice(0, 100).toLowerCase())!)),
      ];
      let parentId: string | undefined;
      if (it.parentExt !== undefined) {
        parentId = taskOf.get(it.parentExt);
        if (!parentId) notes.push(`родитель «${it.parentExt}» не найден`);
      }
      const description =
        it.description === undefined
          ? undefined
          : it.description === null
            ? null
            : docOf(it.description);
      const title = it.title.slice(0, 500);
      if (title !== it.title) notes.push('заголовок обрезан до 500 символов');
      const ext = it.externalId;
      const existing = ext ? taskOf.get(ext) : undefined;
      if (existing && (exists.has(existing) || fresh.has(ext!))) {
        const [cur, curL] = await Promise.all([
          db.execute(sql`select user_id from task_assignees where task_id = ${existing}`),
          db.execute(sql`select label_id from task_labels where task_id = ${existing}`),
        ]);
        const hadA = (cur.rows as { user_id: string }[]).map((r) => r.user_id);
        const hadL = (curL.rows as { label_id: string }[]).map((r) => r.label_id);
        const muts: Mut[] = [
          {
            name: 'task.update',
            args: {
              id: existing,
              title,
              ...(statusId && { statusId }),
              ...(description !== undefined && { description }),
              ...(it.priority !== undefined && { priority: it.priority }),
              ...(it.dueDate !== undefined && { dueDate: it.dueDate }),
              ...(it.startDate !== undefined && { startDate: it.startDate }),
              ...(it.parentExt !== undefined && { parentId: parentId ?? null }),
            },
          },
        ];
        // полная замена, только если колонка сопоставлена
        if (it.assignees) {
          for (const u of hadA)
            if (!assigneeIds.includes(u))
              muts.push({ name: 'task.unassign', args: { taskId: existing, userId: u } });
          for (const u of assigneeIds)
            if (!hadA.includes(u))
              muts.push({
                name: 'task.assign',
                args: { id: uuidv7(), taskId: existing, userId: u },
              });
        }
        if (it.labels) {
          for (const l of hadL)
            if (!labelIds.includes(l))
              muts.push({ name: 'task.removeLabel', args: { taskId: existing, labelId: l } });
          for (const l of labelIds)
            if (!hadL.includes(l))
              muts.push({
                name: 'task.addLabel',
                args: { id: uuidv7(), taskId: existing, labelId: l },
              });
        }
        return {
          muts,
          kind: 'updated',
          attach: ext ? { ext, taskId: existing } : undefined,
          notes,
        };
      }
      const id = uuidv7();
      const createStatus = statusId ?? defaultStatus;
      const muts: Mut[] = [
        {
          name: 'task.create',
          args: {
            id,
            projectId: job!.projectId,
            statusId: createStatus,
            title,
            rank: await nextRank(createStatus),
            parentId,
            description,
            priority: it.priority,
            dueDate: it.dueDate,
            startDate: it.startDate,
            assignees: assigneeIds.map((userId) => ({ id: uuidv7(), userId })),
            labels: labelIds.map((labelId) => ({ id: uuidv7(), labelId })),
          },
        },
      ];
      let ck: string | null = null;
      (it.checklist ?? []).forEach((c) => {
        const cid = uuidv7();
        ck = generateKeyBetween(ck, null);
        muts.push({
          name: 'checklist.add',
          args: { id: cid, taskId: id, text: c.text.slice(0, 500) || '-', rank: ck },
        });
        if (c.done) muts.push({ name: 'checklist.update', args: { id: cid, done: true } });
      });
      return { muts, kind: 'created', attach: ext ? { ext, taskId: id } : undefined, notes };
    };

    const prepare =
      (rows: { ext: string; taskId: string }[]) =>
      async (tx: { execute: (q: never) => Promise<unknown> }) => {
        if (!rows.length) return;
        const vals = sql.join(
          rows.map((r) => sql`(${job!.projectId}, ${job!.preset}, ${r.ext}, ${r.taskId}, now())`),
          sql`, `,
        );
        await tx.execute(
          sql`
        insert into import_items (project_id, preset, external_id, task_id, updated_at) values ${vals}
        on conflict (project_id, preset, external_id) do update set task_id = excluded.task_id, updated_at = now()` as never,
        );
      };

    for (let b = 0; b < order.length; b += BATCH) {
      const rows: Awaited<ReturnType<typeof buildRow>>[] = [];
      const src: Item[] = [];
      for (const i of order.slice(b, b + BATCH)) {
        const it = items[i]!;
        if (it.skip) {
          skipped.push({ row: it.row, reason: it.skip });
          continue;
        }
        const r = await buildRow(it);
        // последующие строки (дети, повторы externalId) видят id этой задачи
        if (r.attach) {
          taskOf.set(r.attach.ext, r.attach.taskId);
          if (r.kind === 'created') fresh.add(r.attach.ext);
        }
        rows.push(r);
        src.push(it);
      }
      const apply = (rs: typeof rows) =>
        api.execute(
          job!.userId,
          rs.flatMap((r) => r.muts),
          {
            prepare: prepare(rs.flatMap((r) => (r.attach ? [r.attach] : []))) as never,
          },
        );
      const ok = (r: (typeof rows)[number], it: Item) => {
        if (r.kind === 'created') created++;
        else updated++;
        for (const n of r.notes) warnings.push({ row: it.row, message: n });
      };
      try {
        await apply(rows);
        rows.forEach((r, k) => ok(r, src[k]!));
      } catch {
        // пачка откатилась целиком: по одной строке, чтобы найти виновную
        for (let k = 0; k < rows.length; k++) {
          try {
            await apply([rows[k]!]);
            ok(rows[k]!, src[k]!);
          } catch (e) {
            skipped.push({ row: src[k]!.row, reason: msg(e) });
            // задача не создана: дети не должны ссылаться на неё
            const a = rows[k]!.attach;
            if (a && rows[k]!.kind === 'created') {
              taskOf.delete(a.ext);
              fresh.delete(a.ext);
            }
          }
        }
      }
      processed = Math.min(order.length, b + BATCH);
      await touch({ processed, created, updated, skipped, warnings });
    }
    await touch({
      status: 'done',
      processed: order.length,
      created,
      updated,
      skipped,
      warnings,
      source: null,
    });
  } catch (e) {
    await touch({
      status: 'failed',
      error: msg(e),
      created,
      updated,
      skipped,
      warnings,
      source: null,
    });
  }
}

const jobs = [
  {
    queue: 'import.run',
    // повтор не нужен: частичный прогон идемпотентен только по externalId, ошибка фиксируется в job
    retryLimit: 0,
    expireInSeconds: 3600,
    async handler(data: { jobId: string }, api: JobApi) {
      // захват: параллельные/повторные доставки не запускают импорт дважды
      const r = await api.db.execute(
        sql`update import_jobs set status = 'running', updated_at = now() where id = ${data.jobId} and status = 'pending' returning id`,
      );
      if (r.rows.length) await runImport(data.jobId, api);
    },
  },
  {
    // страховка: подбирает pending, если постановка из контроллера не удалась
    queue: 'import.sweep',
    cron: '* * * * *',
    async handler(_: unknown, api: JobApi) {
      const rows = await api.db
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(eq(importJobs.status, 'pending'));
      for (const r of rows)
        await api.enqueue('import.run', { jobId: r.id }, { singletonKey: r.id });
    },
  },
];

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: ImportModule,
  mutators: shared.mutators,
  entities: shared.entities,
  jobs,
};
