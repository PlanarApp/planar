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
  STATUS_CATEGORIES,
  mappingSchema,
  shared,
  type FileFormat,
  type ImportFormat,
  type ImportPreset,
  type Mapping,
  type Preview,
  type StatusCategory,
} from '../shared/index.js';
import {
  ParseError,
  TRELLO_MAPPING,
  distinctValues,
  parseSource,
  suggestMapping,
  type Item,
} from './parse.js';
import { htmlToDoc, imageSrcs, type MentionOf } from './html.js';
import {
  PLANE_API_MAPPING,
  planeClient,
  planeConnSchema,
  planeItems,
  planePreview,
  PlaneForbidden,
  type PlaneConn,
  type PlaneData,
} from './plane.js';
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

/** Multipart fields and the file; file ≤ MAX_BYTES, otherwise 400; plane-api comes without a file. */
async function readForm(
  req: FastifyRequest,
): Promise<{ fields: Record<string, string>; file?: string }> {
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
  if (!file && fields.format !== 'plane-api') throw bad('Нужно поле file');
  return { fields, file: file?.toString('utf8') };
}

function formatPreset(f: Record<string, string>): [ImportFormat, ImportPreset] {
  const format = f.format as ImportFormat;
  const preset = f.preset as ImportPreset;
  if (!FORMATS.includes(format) || !PRESETS.includes(preset)) throw bad('format/preset неверны');
  if ((format === 'trello') !== (preset === 'trello')) throw bad('preset не подходит формату');
  if (format === 'plane-api' && preset !== 'plane') throw bad('preset не подходит формату');
  return [format, preset];
}

/**
 * Plane connection from the form; only an instance owner/admin: the server goes to the given address,
 * internal network included. Plane errors (token, address, certificate) — 400.
 */
function planeConn(core: CoreServices, req: FastifyRequest, f: Record<string, string>): PlaneConn {
  core.requireInstanceAdmin(req);
  const r = planeConnSchema.safeParse(f);
  if (!r.success) throw bad(r.error.issues[0]!.message);
  return r.data;
}
const planeOrBad = async <T>(p: Promise<T>) => {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ParseError || e instanceof PlaneForbidden) throw bad(e.message);
    throw e;
  }
};

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

/** the wizard's value tables over Plane's fixed fields */
function planeMapping(s = '{}'): string {
  try {
    return JSON.stringify({ ...(JSON.parse(s) as object), ...PLANE_API_MAPPING });
  } catch {
    throw bad('mapping неверен');
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
    const { fields, file = '' } = await readForm(req);
    const [format, preset] = formatPreset(fields);
    if (format === 'plane-api') return planeOrBad(planePreview(planeConn(this.core, req, fields)));
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
    const { fields, file = '' } = await readForm(req);
    const [format, preset] = formatPreset(fields);
    const conn = format === 'plane-api' ? planeConn(this.core, req, fields) : null;
    let mapping =
      format === 'trello' && !fields.mapping
        ? TRELLO_MAPPING
        : // plane-api: fixed fields, the wizard sends only the value tables
          conn
          ? parseMapping(planeMapping(fields.mapping))
          : parseMapping(fields.mapping ?? '');
    // the main project, or only the space — then the rows go to projects by the project column
    const projectId = fields.projectId || null;
    if (projectId !== null && !UUID.test(projectId)) throw bad('projectId неверен');
    if (projectId === null && !UUID.test(fields.spaceId ?? ''))
      throw bad('нужен projectId или spaceId');
    if (projectId === null && !mapping.project) throw bad('без проекта нужна колонка проекта');
    // a space member with a role no lower than member may write to a project; someone else's project — as a nonexistent one
    const ok = await this.core.db.execute(
      projectId
        ? sql`
      select p.space_id from projects p join space_members m on m.space_id = p.space_id
      where p.id = ${projectId} and m.user_id = ${userId} and m.role in ('admin', 'member')
        and project_role(${userId}::uuid, p.id) in ('admin', 'member')`
        : sql`
      select m.space_id from space_members m
      where m.space_id = ${fields.spaceId} and m.user_id = ${userId} and m.role in ('admin', 'member')`,
    );
    if (!ok.rows.length)
      throw new HttpError(
        404,
        'not_found',
        projectId ? 'Проект не найден' : 'Пространство не найдено',
      );
    // plane-api: issues are read by the job; for creating projects only their keys are needed (also checks the token)
    const items: Item[] = conn
      ? (
          await planeOrBad(
            planeClient(conn).all<{ name: string; identifier: string }>('/projects/'),
          )
        ).map((pr, i) => ({
          row: i,
          title: '',
          project: pr.name,
          projectKey: pr.identifier,
          notes: [],
        }))
      : parseOrThrow(file, format as FileFormat, mapping, preset).items;
    const spaceId = (ok.rows[0] as { space_id: string }).space_id;
    mapping = await resolveNew(this.core, auth, spaceId, mapping, items);
    const [row] = await this.core.db
      .insert(importJobs)
      .values({
        id: uuidv7(),
        userId,
        projectId,
        spaceId,
        format,
        preset,
        total: conn ? 0 : items.length,
        source: conn ? JSON.stringify(conn) : file,
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
// as the default statuses of a new project (packages/shared mutators/projects.ts)
const STATUS_COLOR: Record<StatusCategory, string> = {
  backlog: '#94a3b8',
  todo: '#64748b',
  in_progress: '#3b82f6',
  done: '#22c55e',
  cancelled: '#ef4444',
};
const docOf = (text: string) => ({
  type: 'doc',
  content: text
    .split(/\r?\n/)
    .map((l) =>
      l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' },
    ),
});

/** the source date/author line above an HTML comment */
const withHead = (head: string, d: Record<string, unknown> | null) => {
  const body = (d?.content as unknown[] | undefined) ?? [];
  return head ? { type: 'doc', content: [...docOf(head).content, ...body] } : (d ?? docOf('-'));
};

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
    let items: Item[];
    let plane: PlaneData | undefined;
    if (job!.format === 'plane-api') {
      const conn = planeConnSchema.parse(JSON.parse(job!.source ?? '{}'));
      // only the chosen projects; with a main project every row has a place — all projects
      const names = job!.projectId ? null : new Set(Object.keys(mapping.projectMap ?? {}));
      // pages go to the project of the Plane project's issues: only where «Документы» is on
      const docs = new Set(
        (
          await db.execute(
            sql`select id from projects where space_id = ${job!.spaceId} and 'docs' = any(modules)`,
          )
        ).rows.map((r) => (r as { id: string }).id),
      );
      const target = (name: string) => mapping.projectMap?.[name] || job!.projectId;
      plane = await planeItems(
        conn,
        names,
        () => touch({}),
        (name) => docs.has(target(name) ?? ''),
      );
      items = plane.items;
      warnings.push(...plane.warnings);
    } else
      ({ items } = parseSource(
        job!.source ?? '',
        job!.format as FileFormat,
        mapping,
        job!.preset as ImportPreset,
      ));
    await touch({ total: items.length });

    const q = <T>(s: ReturnType<typeof sql>) => db.execute(s).then((r) => r.rows as T[]);
    const main = job!.projectId;
    let spaceId = job!.spaceId;
    if (!spaceId) {
      // older jobs: the main project's space
      const [project] = await q<{ space_id: string }>(
        sql`select space_id from projects where id = ${main}`,
      );
      if (!project) throw new Error('Проект не найден');
      spaceId = project.space_id;
    }
    // project of a row: by projectMap (ids in the import space, checked on creation), otherwise — the main one
    const projectMap = mapping.projectMap ?? {};
    const projOf = (it: Item): string | null =>
      (it.project !== undefined && projectMap[it.project]) || main;
    const pids = [...new Set([main, ...items.map(projOf)].filter((p): p is string => p !== null))];
    const pidList = pids.length
      ? sql.join(
          pids.map((p) => sql`${p}::uuid`),
          sql`, `,
        )
      : sql`null`;
    const live = new Set(
      (
        await q<{ id: string }>(
          sql`select id from projects where id in (${pidList}) and space_id = ${spaceId}`,
        )
      ).map((r) => r.id),
    );
    if (main && !live.has(main)) throw new Error('Проект не найден');

    const statusRows = await q<{
      id: string;
      project_id: string;
      name: string;
      category: string;
      rank: string;
    }>(
      sql`select id, project_id, name, category, rank from statuses where project_id in (${pidList}) order by rank collate "C"`,
    );
    const statusName = new Map(statusRows.map((s) => [s.id, s.name.toLowerCase()]));
    const perProject = new Map<
      string,
      { def?: string; byName: Map<string, string>; list: typeof statusRows }
    >();
    for (const pid of pids) {
      const ss = statusRows.filter((s) => s.project_id === pid);
      perProject.set(pid, {
        def: (ss.find((s) => s.category === 'todo') ?? ss.find((s) => s.category === 'backlog'))
          ?.id,
        byName: new Map(ss.map((s) => [s.name.toLowerCase(), s.id])),
        list: ss,
      });
    }
    if (main && !perProject.get(main)!.def) throw new Error('Нет статуса по умолчанию');
    const statusMap = new Map(Object.entries(mapping.statusMap ?? {}));
    /**
     * statusMap holds statuses of the main project; another project gets the status of the same name.
     * Values outside the preview's 20 rows are not in statusMap: matched by status name (created ones included).
     */
    const statusOf = (pid: string, v: string) => {
      const p = perProject.get(pid)!;
      const mapped = statusMap.get(v);
      if (mapped && pid === main) return mapped;
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
    const loginOf = new Map<string, string>();
    for (const u of await q<{ id: string; login: string; email: string | null }>(sql`
      select u.id, u.login, u.email from users u join space_members m on m.user_id = u.id
      where m.space_id = ${spaceId} and u.deactivated_at is null`)) {
      users.set(u.login.toLowerCase(), u.id);
      loginOf.set(u.id, u.login);
    }
    // email takes precedence over login: overwrites on matching rows
    for (const u of await q<{ id: string; email: string }>(sql`
      select u.id, u.email from users u join space_members m on m.user_id = u.id
      where m.space_id = ${spaceId} and u.deactivated_at is null and u.email is not null`)) {
      users.set(u.email.toLowerCase(), u.id);
    }
    // Plane API: a person not in the table — by their Plane e-mail
    const person = (name: string) =>
      userMap.get(name.toLowerCase()) ??
      users.get(name.toLowerCase()) ??
      users.get(plane?.emails.get(name)?.toLowerCase() ?? '');
    const mentionOf: MentionOf = (planeId) => {
      const name = plane?.people.get(planeId);
      if (!name) return null;
      const id = person(name);
      const login = id && loginOf.get(id);
      return login ? { id: id!, label: login } : name;
    };
    // Plane files: stored on behalf of the importer; an error or the size limit — a row warning, the import goes on
    const fetchFile = async (
      it: Item,
      asset: string,
      name: string,
      mime: string,
      notes: string[],
    ) => {
      try {
        if (!api.files) throw new Error('хранилище файлов недоступно');
        const f = await plane!.file(it.plane!.project, it.plane!.issue, asset, api.files.maxBytes);
        return await api.files.store(f.buf, job!.userId, mime || f.mime || undefined);
      } catch (e) {
        notes.push(`файл «${name}» не импортирован: ${msg(e)}`);
        return null;
      }
    };
    /** images of the HTML (asset id → /files/<sha>) */
    const storeImages = async (it: Item, htmls: string[], notes: string[]) => {
      const out = new Map<string, string>();
      if (!it.plane) return out;
      for (const src of new Set(htmls.flatMap(imageSrcs)))
        if (UUID.test(src)) {
          const f = await fetchFile(it, src, 'изображение', '', notes);
          if (f) out.set(src, `/files/${f.sha256}`);
        }
      return out;
    };
    /** attachment.create for the Plane attachments whose file the task does not have yet */
    const attachMuts = async (it: Item, taskId: string, isUpdate: boolean, notes: string[]) => {
      if (!it.plane?.attachments.length) return [];
      const had = new Set(
        isUpdate
          ? (
              await q<{ file_sha256: string }>(
                sql`select file_sha256 from attachments where task_id = ${taskId}`,
              )
            ).map((r) => r.file_sha256)
          : [],
      );
      const muts: Mut[] = [];
      for (const a of it.plane.attachments) {
        const f = await fetchFile(it, a.id, a.name, a.mime, notes);
        if (!f || had.has(f.sha256)) continue;
        had.add(f.sha256);
        muts.push({
          name: 'attachment.create',
          args: {
            id: uuidv7(),
            taskId,
            fileSha256: f.sha256,
            name: a.name,
            mime: f.mime,
            size: f.size,
            width: f.width,
            height: f.height,
          },
        });
      }
      return muts;
    };

    for (const it of items) {
      if (it.skip) continue;
      const pid = projOf(it);
      if (pid === null) it.skip = 'нет проекта';
      else if (!live.has(pid)) it.skip = `проект «${it.project}» не найден`;
    }
    // below — rows not skipped: their project is known
    const pidOf = (it: Item) => projOf(it)!;

    // statuses from statusNew: in each project of the value's rows that has no status of that name
    const statusNew = mapping.statusNew ?? {};
    const makeStatus: Mut[] = [];
    for (const it of items) {
      if (it.skip || !it.status || !statusNew[it.status]) continue;
      const pid = pidOf(it);
      // the main project's statusMap goes first: the value is already placed
      if (pid === main && statusMap.has(it.status)) continue;
      const p = perProject.get(pid)!;
      if (p.byName.has(it.status.toLowerCase())) continue;
      const category = statusNew[it.status]!;
      // after the last status of the category (order of categories — as in the project), otherwise at the end
      const order = STATUS_CATEGORIES.indexOf(category);
      const at = p.list.findLastIndex(
        (s) => STATUS_CATEGORIES.indexOf(s.category as StatusCategory) <= order,
      );
      const rank = generateKeyBetween(p.list[at]?.rank ?? null, p.list[at + 1]?.rank ?? null);
      const id = uuidv7();
      const name = it.status.slice(0, 100);
      p.list.splice(at + 1, 0, { id, project_id: pid, name, category, rank });
      p.byName.set(it.status.toLowerCase(), id);
      p.def ??= category === 'todo' || category === 'backlog' ? id : undefined;
      makeStatus.push({
        name: 'status.create',
        args: { id, projectId: pid, name, category, color: STATUS_COLOR[category], rank },
      });
    }
    for (let i = 0; i < makeStatus.length; i += BATCH)
      await api.execute(job!.userId, makeStatus.slice(i, i + BATCH));

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
      const pid = pidOf(it);
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
      const pid = (isUpdate && projectOfTask.get(existing!)) || pidOf(it);
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
      // comments are imported only into a new task: their images too
      const images = await storeImages(
        it,
        [
          it.descriptionHtml ?? '',
          ...(isUpdate ? [] : (it.comments ?? []).map((c) => c.html ?? '')),
        ],
        notes,
      );
      const imageOf = (src: string) => images.get(src) ?? null;
      const description =
        it.descriptionHtml !== undefined
          ? htmlToDoc(it.descriptionHtml, mentionOf, imageOf)
          : it.description === undefined
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
        muts.push(...(await attachMuts(it, existing, true, notes)));
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
      muts.push(...(await attachMuts(it, id, false, notes)));
      // the comment date is set by the mutator (now): the source date goes into the first line
      const comments = (it.comments ?? []).map((c) => {
        const author = c.author ? person(c.author) : undefined;
        const head = [c.at.slice(0, 16), author ? '' : c.author].filter(Boolean).join(' · ');
        return {
          userId: author ?? job!.userId,
          mut: {
            name: 'comment.create',
            args: {
              id: uuidv7(),
              taskId: id,
              body:
                c.html === undefined
                  ? docOf(head ? `${head}\n${c.text}` : c.text)
                  : withHead(head, htmlToDoc(c.html, mentionOf, imageOf)),
            },
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
      (rows: { ext: string; taskId: string; projectId: string }[], preset = job!.preset) =>
      async (tx: { execute: (q: never) => Promise<unknown> }) => {
        if (!rows.length) return;
        const vals = sql.join(
          rows.map((r) => sql`(${r.projectId}, ${preset}, ${r.ext}, ${r.taskId}, now())`),
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
            // thousands of rows: no assignment notifications, the importer gets the report (PLNRAPP-247)
            quiet: true,
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
              { system: true, quiet: true },
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

    // Plane pages: one by one (a few dozen); import_items keeps Plane page id → our page (preset plane-page)
    const pages = plane?.pages.filter((pg) => live.has(projectMap[pg.project] || main || ''));
    if (pages?.length) {
      const PRESET = 'plane-page';
      const pageOf = new Map<string, { id: string; archived: boolean }>();
      for (const r of await q<{ external_id: string; id: string; archived_at: string | null }>(sql`
        select i.external_id, p.id, p.archived_at from import_items i join docs_pages p on p.id = i.task_id
        where i.project_id in (${pidList}) and i.preset = ${PRESET}`))
        pageOf.set(r.external_id, { id: r.id, archived: !!r.archived_at });
      // parents before children: by depth within the import
      const byId = new Map(pages.map((pg) => [pg.id, pg]));
      const depth = (pg: (typeof pages)[number], n = 0): number => {
        const up = pg.parent ? byId.get(pg.parent) : undefined;
        return up && n < pages.length ? depth(up, n + 1) : n;
      };
      const lastPageRank = new Map<string, string | null>();
      for (const pg of [...pages].sort((a, b) => depth(a) - depth(b))) {
        const pid = projectMap[pg.project] || main!;
        const title = (pg.name || 'Без названия').slice(0, 200);
        const body = htmlToDoc(pg.html, mentionOf) ?? { type: 'doc', content: [] };
        const known = pageOf.get(pg.id);
        const fail = (e: unknown) =>
          warnings.push({ row: 0, message: `страница «${title}» не импортирована: ${msg(e)}` });
        if (known?.archived) {
          warnings.push({ row: 0, message: `страница «${title}» в архиве: не обновлена` });
          continue;
        }
        if (/<image-component/.test(pg.html))
          // shortcut: Plane gives page images no download path by the API token — a caption instead
          warnings.push({ row: 0, message: `страница «${title}»: картинки заменены подписью` });
        try {
          if (known) {
            await api.execute(
              job!.userId,
              [{ name: 'docs.page.update', args: { id: known.id, title, body } }],
              { quiet: true },
            );
            updated++;
            continue;
          }
          const parentId = (pg.parent && pageOf.get(pg.parent)?.id) || null;
          const rkey = `${pid}\u0000${parentId ?? ''}`;
          if (!lastPageRank.has(rkey)) {
            const [r] = await q<{ m: string | null }>(
              sql`select max(rank) as m from docs_pages where project_id = ${pid} and parent_id is not distinct from ${parentId}`,
            );
            lastPageRank.set(rkey, r?.m ?? null);
          }
          const rank = generateKeyBetween(lastPageRank.get(rkey)!, null);
          const id = uuidv7();
          await api.execute(
            job!.userId,
            [
              {
                name: 'docs.page.create',
                args: { id, spaceId, projectId: pid, parentId, rank, title, body },
              },
            ],
            {
              quiet: true,
              prepare: prepare([{ ext: pg.id, taskId: id, projectId: pid }], PRESET) as never,
            },
          );
          lastPageRank.set(rkey, rank);
          pageOf.set(pg.id, { id, archived: false });
          created++;
        } catch (e) {
          fail(e);
        }
      }
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
      // a process died mid-import (deploy, OOM): every batch touches updated_at, so 2 h of silence is a dead run
      await api.db.execute(
        sql`update import_jobs set status = 'failed', error = 'Импорт прерван: процесс остановился', source = null,
          updated_at = now() where status = 'running' and updated_at < now() - interval '2 hours'`,
      );
      const rows = await api.db
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(eq(importJobs.status, 'pending'));
      for (const r of rows)
        await api.enqueue('import.run', { jobId: r.id }, { singletonKey: r.id });
    },
  },
];

export {
  parseSource,
  ParseError,
  TRELLO_MAPPING,
  distinctValues,
  suggestMapping,
} from './parse.js';
export type { Item } from './parse.js';

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: ImportModule,
  mutators: shared.mutators,
  entities: shared.entities,
  jobs,
};
