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
import {
  ParseError,
  TRELLO_MAPPING,
  distinctValues,
  parseSource,
  suggestMapping,
  type Item,
} from './parse.js';
import { resolveNew } from './resolve.js';
import { importJobs, type RowNote, type RowWarning } from './schema.js';

// a minimum from a fastify request with @fastify/multipart (fastify is not a module dependency)
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

/** Multipart fields and the file; file ≤ MAX_BYTES, otherwise 400. */
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
    // RequestFileTooLargeError and other FST_* — a client error
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

function parseMapping(s: string): Mapping {
  try {
    return mappingSchema.parse(JSON.parse(s));
  } catch {
    throw bad('mapping неверен');
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
    // with mapping — the wizard re-reads values over the whole file after a column change
    const mapping = format === 'csv' && fields.mapping ? parseMapping(fields.mapping) : null;
    const p = parseOrThrow(file, format, mapping, preset);
    return {
      columns: p.columns,
      rows: p.rows.slice(0, 20),
      mapping:
        mapping ?? (format === 'trello' ? TRELLO_MAPPING : suggestMapping(p.columns, preset)),
      values: distinctValues(p.items),
    };
  }

  @Post('jobs')
  @HttpCode(202)
  async create(@Req() req: FastifyRequest) {
    const auth = this.core.auth(req);
    const { userId } = auth;
    const { fields, file } = await readForm(req);
    const [format, preset] = formatPreset(fields);
    let mapping =
      format === 'trello' && !fields.mapping ? TRELLO_MAPPING : parseMapping(fields.mapping ?? '');
    if (!UUID.test(fields.projectId ?? '')) throw bad('projectId неверен');
    const projectId = fields.projectId!;
    // a space member with a role no lower than member may write to a project; someone else's project — as a nonexistent one
    const ok = await this.core.db.execute(sql`
      select p.space_id from projects p join space_members m on m.space_id = p.space_id
      where p.id = ${projectId} and m.user_id = ${userId} and m.role in ('admin', 'member')
        and project_role(${userId}::uuid, p.id) in ('admin', 'member')`);
    if (!ok.rows.length) throw new HttpError(404, 'not_found', 'Проект не найден');
    const p = parseOrThrow(file, format, mapping, preset);
    const spaceId = (ok.rows[0] as { space_id: string }).space_id;
    mapping = await resolveNew(this.core, auth, spaceId, mapping, p.items);
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
    // straight into the queue; import.sweep stays as a safety net
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

// ---------- background import ----------

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
    // project of a row: by projectMap (ids in the job project's space, checked on creation), otherwise — the job's
    const projectMap = mapping.projectMap ?? {};
    const projOf = (it: Item) =>
      (it.project !== undefined && projectMap[it.project]) || job!.projectId;
    const pids = [...new Set([job!.projectId, ...items.map(projOf)])];
    const pidList = sql.join(
      pids.map((p) => sql`${p}::uuid`),
      sql`, `,
    );
    const live = new Set(
      (
        await q<{ id: string }>(
          sql`select id from projects where id in (${pidList}) and space_id = ${spaceId}`,
        )
      ).map((r) => r.id),
    );

    const statusRows = await q<{ id: string; project_id: string; name: string; category: string }>(
      sql`select id, project_id, name, category from statuses where project_id in (${pidList}) order by rank`,
    );
    const statusName = new Map(statusRows.map((s) => [s.id, s.name.toLowerCase()]));
    const perProject = new Map<string, { def?: string; byName: Map<string, string> }>();
    for (const pid of pids) {
      const ss = statusRows.filter((s) => s.project_id === pid);
      perProject.set(pid, {
        def: (ss.find((s) => s.category === 'todo') ?? ss.find((s) => s.category === 'backlog'))
          ?.id,
        byName: new Map(ss.map((s) => [s.name.toLowerCase(), s.id])),
      });
    }
    if (!perProject.get(job!.projectId)!.def) throw new Error('Нет статуса по умолчанию');
    const statusMap = new Map(Object.entries(mapping.statusMap ?? {}));
    /**
     * statusMap holds statuses of the job project; another project gets the status of the same name.
     * Values outside the preview's 20 rows are not in statusMap: matched by status name.
     */
    const statusOf = (pid: string, v: string) => {
      const p = perProject.get(pid)!;
      const mapped = statusMap.get(v);
      if (mapped && pid === job!.projectId) return mapped;
      return (
        (mapped && p.byName.get(statusName.get(mapped) ?? '')) ??
        p.byName.get(v.toLowerCase()) ??
        p.def
      );
    };

    const members = new Set(
      (
        await q<{ user_id: string }>(
          sql`select user_id from space_members where space_id = ${spaceId}`,
        )
      ).map((r) => r.user_id),
    );
    // names from the wizard's table first (ids — checked/created on job creation)
    const userMap = new Map(
      Object.entries(mapping.userMap ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const users = new Map<string, string>();
    for (const u of await q<{ id: string; login: string; email: string | null }>(sql`
      select u.id, u.login, u.email from users u join space_members m on m.user_id = u.id
      where m.space_id = ${spaceId} and u.deactivated_at is null`)) {
      users.set(u.login.toLowerCase(), u.id);
    }
    // email takes precedence over login: overwrites on matching rows
    for (const u of await q<{ id: string; email: string }>(sql`
      select u.id, u.email from users u join space_members m on m.user_id = u.id
      where m.space_id = ${spaceId} and u.deactivated_at is null and u.email is not null`)) {
      users.set(u.email.toLowerCase(), u.id);
    }
    const person = (name: string) =>
      userMap.get(name.toLowerCase()) ?? users.get(name.toLowerCase());

    for (const it of items)
      if (!it.skip && !live.has(projOf(it))) it.skip = `проект «${it.project}» не найден`;

    // labels by project and name, case-insensitive; missing ones are created in one call
    const labels = new Map<string, string>();
    const lkey = (pid: string, n: string) => `${pid}\u0000${n.slice(0, 100).toLowerCase()}`;
    for (const l of await q<{ id: string; project_id: string; name: string }>(
      sql`select id, project_id, name from labels where project_id in (${pidList})`,
    ))
      labels.set(lkey(l.project_id, l.name), l.id);
    const make: Mut[] = [];
    for (const it of items) {
      if (it.skip) continue;
      const pid = projOf(it);
      for (const n of (it.labels ?? []).map((x) => x.slice(0, 100))) {
        if (labels.has(lkey(pid, n))) continue;
        const id = uuidv7();
        labels.set(lkey(pid, n), id);
        make.push({
          name: 'label.create',
          args: { id, projectId: pid, name: n, color: LABEL_COLOR },
        });
      }
    }
    for (let i = 0; i < make.length; i += BATCH)
      await api.execute(job!.userId, make.slice(i, i + BATCH));

    // external ID → task (previously imported, still existing) and its project
    const known = new Map<string, string>();
    const projectOfTask = new Map<string, string>();
    for (const r of await q<{ external_id: string; task_id: string; project_id: string }>(sql`
      select i.external_id, i.task_id, t.project_id from import_items i join tasks t on t.id = i.task_id
      where i.project_id in (${pidList}) and i.preset = ${job!.preset}`)) {
      known.set(r.external_id, r.task_id);
      projectOfTask.set(r.task_id, r.project_id);
    }
    const exists = new Set(known.values());

    // parents before children; a cycle or unknown parent — no parent
    const byExt = new Map<string, number>();
    items.forEach((it, i) => {
      if (it.externalId && !it.skip && !byExt.has(it.externalId)) byExt.set(it.externalId, i);
    });
    const order: number[] = [];
    const state: number[] = []; // 1 — in the path, 2 — placed
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

    // task ids in advance; a repeated externalId in the file — an update of the first
    const taskOf = new Map(known);
    const fresh = new Set<string>(); // externalIds created by this run
    // last key by status: new tasks go after the existing ones
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
      attach?: { ext: string; taskId: string; projectId: string };
      notes: string[];
      comments: { userId: string; mut: Mut }[];
    }> => {
      const notes = [...it.notes];
      const ext = it.externalId;
      const existing = ext ? taskOf.get(ext) : undefined;
      const isUpdate = !!existing && (exists.has(existing) || fresh.has(ext!));
      // an update stays in the task's project
      const pid = (isUpdate && projectOfTask.get(existing!)) || projOf(it);
      const statusId = it.status === undefined ? undefined : statusOf(pid, it.status);
      const assigneeIds: string[] = [];
      for (const a of it.assignees ?? []) {
        const id = person(a);
        if (!id) notes.push(`исполнитель «${a}» не найден`);
        else if (!members.has(id)) notes.push(`исполнитель «${a}» — не участник пространства`);
        else if (!assigneeIds.includes(id)) assigneeIds.push(id);
      }
      const labelIds = [
        ...new Set(
          (it.labels ?? []).flatMap((n) => {
            const l = labels.get(lkey(pid, n));
            return l ? [l] : [];
          }),
        ),
      ];
      let parentId: string | undefined;
      if (it.parentExt !== undefined) {
        parentId = taskOf.get(it.parentExt);
        if (!parentId) notes.push(`родитель «${it.parentExt}» не найден`);
        else if (projectOfTask.get(parentId) !== pid) {
          parentId = undefined;
          notes.push(`родитель «${it.parentExt}» в другом проекте: не назначен`);
        }
      }
      const description =
        it.description === undefined
          ? undefined
          : it.description === null
            ? null
            : docOf(it.description);
      const title = it.title.slice(0, 500);
      if (title !== it.title) notes.push('заголовок обрезан до 500 символов');
      if (isUpdate && existing) {
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
        // full replacement, only if the column is mapped
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
        // comments — only on creation: a repeated import must not duplicate them
        return {
          muts,
          kind: 'updated',
          attach: ext ? { ext, taskId: existing, projectId: pid } : undefined,
          notes,
          comments: [],
        };
      }
      const id = uuidv7();
      projectOfTask.set(id, pid);
      const createStatus = statusId ?? perProject.get(pid)!.def!;
      const muts: Mut[] = [
        {
          name: 'task.create',
          args: {
            id,
            projectId: pid,
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
      // the comment date is set by the mutator (now): the source date goes into the first line
      const comments = (it.comments ?? []).map((c) => {
        const author = c.author ? person(c.author) : undefined;
        const head = [c.at.slice(0, 16), author ? '' : c.author].filter(Boolean).join(' · ');
        return {
          userId: author ?? job!.userId,
          mut: {
            name: 'comment.create',
            args: { id: uuidv7(), taskId: id, body: docOf(head ? `${head}\n${c.text}` : c.text) },
          },
        };
      });
      return {
        muts,
        kind: 'created',
        attach: ext ? { ext, taskId: id, projectId: pid } : undefined,
        notes,
        comments,
      };
    };

    const prepare =
      (rows: { ext: string; taskId: string; projectId: string }[]) =>
      async (tx: { execute: (q: never) => Promise<unknown> }) => {
        if (!rows.length) return;
        const vals = sql.join(
          rows.map((r) => sql`(${r.projectId}, ${job!.preset}, ${r.ext}, ${r.taskId}, now())`),
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
        // later rows (children, repeated externalIds) see this task's id
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
      const pending: { row: number; userId: string; mut: Mut }[] = [];
      const ok = (r: (typeof rows)[number], it: Item) => {
        if (r.kind === 'created') created++;
        else updated++;
        for (const n of r.notes) warnings.push({ row: it.row, message: n });
        for (const c of r.comments) pending.push({ row: it.row, ...c });
      };
      try {
        await apply(rows);
        rows.forEach((r, k) => ok(r, src[k]!));
      } catch {
        // the batch rolled back entirely: one row at a time to find the culprit
        for (let k = 0; k < rows.length; k++) {
          try {
            await apply([rows[k]!]);
            ok(rows[k]!, src[k]!);
          } catch (e) {
            skipped.push({ row: src[k]!.row, reason: msg(e) });
            // task not created: children must not reference it
            const a = rows[k]!.attach;
            if (a && rows[k]!.kind === 'created') {
              taskOf.delete(a.ext);
              fresh.delete(a.ext);
            }
          }
        }
      }
      // comments after their tasks, on behalf of the author (system: the author need not have rights in the project)
      const byAuthor = new Map<string, typeof pending>();
      for (const c of pending) byAuthor.set(c.userId, [...(byAuthor.get(c.userId) ?? []), c]);
      for (const [author, cs] of byAuthor)
        for (let i = 0; i < cs.length; i += BATCH) {
          const chunk = cs.slice(i, i + BATCH);
          const run = (part: typeof chunk) =>
            api.execute(
              author,
              part.map((c) => c.mut),
              { system: true },
            );
          try {
            await run(chunk);
          } catch {
            for (const c of chunk)
              await run([c]).catch((e: unknown) =>
                warnings.push({ row: c.row, message: `комментарий не импортирован: ${msg(e)}` }),
              );
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
    // no retry needed: a partial run is idempotent only by externalId; the error is recorded in the job
    retryLimit: 0,
    expireInSeconds: 3600,
    async handler(data: { jobId: string }, api: JobApi) {
      // claim: parallel/repeated deliveries do not start the import twice
      const r = await api.db.execute(
        sql`update import_jobs set status = 'running', updated_at = now() where id = ${data.jobId} and status = 'pending' returning id`,
      );
      if (r.rows.length) await runImport(data.jobId, api);
    },
  },
  {
    // safety net: picks up pending if enqueueing from the controller failed
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
