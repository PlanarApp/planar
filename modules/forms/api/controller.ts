import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  SetMetadata,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import { CORE, HttpError, type CoreServices } from '@planar/server-kit';
import { fieldValueSchema, uuidv7, type FieldType } from '@planar/shared';
import { formFields, type FormField } from '../shared/index.js';
import { formsRateLimits as R } from './schema.js';

// same as core's @Public() (apps/api/src/auth/public.ts): the module does not import apps/api
const Public = () => SetMetadata('planar:public', true);

const BODY_MAX = 64 * 1024;
const MAX_FILES = 3;
const notFound = () => new HttpError(404, 'not_found', 'Форма не найдена');
const invalid = (m: string) => new HttpError(400, 'invalid_request', m);

type Def = { id: string; projectId: string; type: FieldType; options: Record<string, unknown> };

/** MB limit for the sum of file sizes (the per-file limit is set by storeFile); shortcut: from env, not from app options. */
const maxUploadBytes = () => (Number(process.env.MAX_UPLOAD_MB) || 50) * 1024 * 1024;

@Controller('api/forms/public')
export class FormsController {
  private formUser?: Promise<string>;

  constructor(@Inject(CORE) private readonly core: CoreServices) {}

  private async load(slug: string) {
    const [f] = await this.core.db
      .execute<{
        id: string;
        project_id: string;
        space_id: string;
        title: string;
        description: string | null;
        fields: unknown;
        status_id: string;
        enabled: boolean;
        modules: string[];
      }>(
        sql`select f.*, p.modules from forms_forms f join projects p on p.id = f.project_id
      where f.slug = ${slug} and f.enabled and p.archived_at is null`,
      )
      .then((r) => r.rows);
    if (!f) throw notFound();
    // C-schema v16: the module is off in the form's project
    if (!f.modules.includes('forms'))
      throw new HttpError(404, 'module_disabled', 'Модуль forms выключен в проекте');
    const fields = formFields.safeParse(f.fields);
    if (!fields.success) throw notFound();
    return { ...f, fields: fields.data };
  }

  private async defs(projectId: string, fields: FormField[]): Promise<Map<string, Def>> {
    const ids = fields.filter((x) => x.key.startsWith('field:')).map((x) => x.key.slice(6));
    if (!ids.length) return new Map();
    const rows = await this.core.db.execute<{
      id: string;
      project_id: string;
      type: FieldType;
      options: Record<string, unknown>;
    }>(sql`select id, project_id, type, options from field_defs
      where project_id = ${projectId} and id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`);
    return new Map(
      rows.rows.map((r) => [
        `field:${r.id}`,
        { id: r.id, projectId: r.project_id, type: r.type, options: r.options },
      ]),
    );
  }

  @Public()
  @Get(':slug')
  async schema(@Param('slug') slug: string) {
    const f = await this.load(slug);
    const defs = await this.defs(f.project_id, f.fields);
    return {
      title: f.title,
      description: f.description,
      fields: f.fields.flatMap((x) => {
        const base = { key: x.key, label: x.label, required: x.required };
        if (x.key === 'title') return [{ ...base, type: 'text' }];
        if (x.key === 'description') return [{ ...base, type: 'longtext' }];
        if (x.key === 'email') return [{ ...base, type: 'email' }];
        if (x.key === 'files') return [{ ...base, type: 'files' }];
        const d = defs.get(x.key);
        if (!d) return []; // project field deleted
        return [
          {
            ...base,
            type: d.type,
            ...(d.type === 'select' && { options: d.options.choices }),
          },
        ];
      }),
    };
  }

  /** ≤ 5 per minute and ≤ 30 per hour per IP: all POSTs that reach the form are counted. */
  private async limit(ip: string) {
    const hit = async (key: string, interval: string) => {
      const stale = sql`${R.windowStartedAt} < now() - ${interval}::interval`;
      const [r] = await this.core.db
        .insert(R)
        .values({ key, count: 1, windowStartedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: R.key,
          set: {
            count: sql`case when ${stale} then 1 else ${R.count} + 1 end`,
            windowStartedAt: sql`case when ${stale} then now() else ${R.windowStartedAt} end`,
          },
        })
        .returning({ n: R.count });
      return r!.n;
    };
    const [m, h] = [await hit(`${ip}|m`, '1 minute'), await hit(`${ip}|h`, '1 hour')];
    if (m > 5 || h > 30)
      throw new HttpError(429, 'rate_limited', 'Слишком много отправок, повторите позже');
  }

  @Public()
  @Post(':slug')
  @HttpCode(201)
  async submit(@Param('slug') slug: string, @Req() req: FastifyRequest, @Body() jsonBody: unknown) {
    const f = await this.load(slug);
    await this.limit(req.ip);
    const files: { buf: Buffer; name: string; mime: string }[] = [];
    let raw: unknown;
    if (req.isMultipart()) {
      if (!f.fields.some((x) => x.key === 'files')) throw invalid('Форма не принимает файлы');
      let total = 0;
      try {
        for await (const part of req.parts({ limits: { fileSize: maxUploadBytes() } })) {
          if (part.type === 'file') {
            if (part.fieldname !== 'file') {
              part.file.resume();
              throw invalid('Файлы — в поле file');
            }
            if (files.length >= MAX_FILES) {
              part.file.resume();
              throw invalid(`Не более ${MAX_FILES} файлов`);
            }
            const buf = await part.toBuffer();
            if (part.file.truncated || (total += buf.length) > maxUploadBytes())
              throw new HttpError(413, 'payload_too_large', 'Файлы слишком большие');
            files.push({ buf, name: part.filename || 'file', mime: part.mimetype });
          } else if (part.fieldname === 'payload') {
            try {
              raw = JSON.parse(String(part.value));
            } catch {
              throw invalid('payload: некорректный JSON');
            }
          }
        }
      } catch (e) {
        // fastify-multipart throws FST_* with a statusCode (size limit, etc.)
        const code = (e as { statusCode?: number }).statusCode;
        if (e instanceof HttpError) throw e;
        if (code === 413) throw new HttpError(413, 'payload_too_large', 'Файлы слишком большие');
        if (code && code < 500) throw invalid('Некорректный multipart');
        throw e;
      }
    } else {
      if (
        Number(req.headers['content-length']) > BODY_MAX ||
        JSON.stringify(jsonBody ?? null).length > BODY_MAX
      )
        throw new HttpError(413, 'payload_too_large', 'Тело запроса слишком большое');
      raw = jsonBody;
    }
    const body = z
      .strictObject({ values: z.record(z.string(), z.unknown()), website: z.string().optional() })
      .safeParse(raw);
    if (!body.success) throw invalid('Некорректное тело запроса');
    if (body.data.website) return { ok: true }; // honeypot

    const defs = await this.defs(f.project_id, f.fields);
    const values = this.validate(f.fields, defs, body.data.values);
    if (f.fields.find((x) => x.key === 'files')?.required && !files.length)
      throw invalid('Приложите файл');

    const user = await (this.formUser ??= this.core.ensureSystemUser('form', 'Форма').catch((e) => {
      this.formUser = undefined;
      throw e;
    }));
    const stored = [];
    for (const x of files)
      stored.push({ ...x, ...(await this.core.storeFile(x.buf, user, x.mime)) });

    const [last] = await this.core.db
      .execute<{ rank: string }>(
        sql`select rank from tasks where status_id = ${f.status_id} order by rank desc limit 1`,
      )
      .then((r) => r.rows);
    const taskId = uuidv7();
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const paras = [
      ...String(values.description ?? '')
        .split(/\n+/)
        .filter(Boolean),
      ...(values.email ? [`Отправитель: ${values.email}`] : []),
    ].map(para);
    await this.core.execute(
      user,
      [
        {
          name: 'task.create',
          args: {
            id: taskId,
            projectId: f.project_id,
            statusId: f.status_id,
            title: values.title,
            rank: generateKeyBetween(last?.rank ?? null, null),
            description: paras.length ? { type: 'doc', content: paras } : null,
          },
        },
        ...[...defs.entries()]
          .filter(([k]) => k in values)
          .map(([k, d]) => ({
            name: 'task.setField',
            args: { taskId, fieldId: d.id, value: values[k] },
          })),
        ...stored.map((s) => ({
          name: 'attachment.create',
          args: {
            id: uuidv7(),
            taskId,
            fileSha256: s.sha256,
            name: s.name,
            mime: s.mime,
            size: s.size,
            width: s.width,
            height: s.height,
          },
        })),
      ],
      { system: true },
    );
    return { ok: true };
  }

  /** The schema is built from the form's fields: extra keys → 400; empty optional ones are dropped. */
  private validate(fields: FormField[], defs: Map<string, Def>, input: Record<string, unknown>) {
    const shape: Record<string, z.ZodType> = {};
    for (const x of fields) {
      if (x.key === 'files') continue;
      const d = defs.get(x.key);
      const t: z.ZodType | undefined =
        x.key === 'title'
          ? z.string().min(1).max(500)
          : x.key === 'description'
            ? z.string().max(10000)
            : x.key === 'email'
              ? z.email().max(254)
              : d && fieldValueSchema(d);
      if (!t) continue;
      shape[x.key] = x.required ? t : t.optional();
    }
    for (const [k, v] of Object.entries(input)) if (v === '' || v === null) delete input[k];
    const r = z.strictObject(shape).safeParse(input);
    if (!r.success)
      throw invalid(
        `Некорректные значения: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`,
      );
    return r.data as Record<string, unknown>;
  }
}
