import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import {
  checkPluginUrl,
  PLUGIN_MUTATORS,
  permissionsSchema,
  pointsSchema,
} from '../shared/index.js';
import { pluginsPlugins as P } from './schema.js';

const base = {
  name: z.string().min(1).max(100),
  url: z.string().max(2000),
  permissions: permissionsSchema,
  points: pointsSchema,
};
const postBody = z.object({ id: z.uuid(), ...base });
const patchBody = z.object({
  name: base.name.optional(),
  url: base.url.optional(),
  permissions: base.permissions.optional(),
  points: base.points.optional(),
  enabled: z.boolean().optional(),
});
const mutateBody = z.object({ name: z.string().min(1).max(100), args: z.unknown() });

// as in apps/api/src/main.ts
const appOrigin = () => process.env.PUBLIC_URL ?? 'http://localhost:5173';
const prod = () => process.env.NODE_ENV === 'production';
const HTTP: Record<string, [number, 'invalid_request' | 'forbidden' | 'not_found' | 'conflict']> = {
  invalid_args: [400, 'invalid_request'],
  forbidden: [403, 'forbidden'],
  not_found: [404, 'not_found'],
  conflict: [409, 'conflict'],
};

const view = (r: typeof P.$inferSelect) => ({
  ...r,
  createdAt: new Date(r.createdAt).toISOString(),
  updatedAt: new Date(r.updatedAt).toISOString(),
});

@Controller('api/plugins')
export class PluginsController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  private checkUrl(url: string) {
    const bad = checkPluginUrl(url, appOrigin(), prod());
    if (bad) throw new HttpError(400, 'invalid_request', bad);
  }

  private async row(id: string) {
    const [r] = z.uuid().safeParse(id).success
      ? await this.core.db.select().from(P).where(eq(P.id, id))
      : [];
    return r;
  }

  private async save(userId: string, a: Record<string, unknown>) {
    await this.core.execute(userId, [{ name: 'plugins.save', args: a }], { system: true });
    return view((await this.row(a.id as string))!);
  }

  @Post('admin')
  @HttpCode(201)
  async create(@Req() req: object, @Body() body: unknown) {
    const { userId } = this.admin(req);
    const b = parseBody(postBody, body);
    this.checkUrl(b.url);
    if (await this.row(b.id)) throw new HttpError(409, 'conflict', 'Плагин уже есть');
    return this.save(userId, { ...b, enabled: true });
  }

  @Patch('admin/:id')
  async patch(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    const { userId } = this.admin(req);
    const b = parseBody(patchBody, body);
    const r = await this.row(id);
    if (!r) throw new HttpError(404, 'not_found', 'Не найдено');
    const next = {
      id,
      name: r.name,
      url: r.url,
      permissions: r.permissions,
      points: r.points,
      enabled: r.enabled,
      ...b,
    };
    this.checkUrl(next.url);
    return this.save(userId, next);
  }

  @Delete('admin/:id')
  @HttpCode(204)
  async remove(@Req() req: object, @Param('id') id: string) {
    const { userId } = this.admin(req);
    if (!(await this.row(id))) throw new HttpError(404, 'not_found', 'Не найдено');
    await this.core.execute(userId, [{ name: 'plugins.delete', args: { id } }], { system: true });
  }

  /** A mutation from a plugin: both the plugin's rights (server) and the session user's (executeMutations). */
  @Post(':id/mutate')
  @HttpCode(204)
  async mutate(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    const auth = this.core.auth(req);
    if (auth.tokenId) throw new HttpError(403, 'forbidden', 'Только сессия');
    const b = parseBody(mutateBody, body);
    const r = await this.row(id);
    const allowed = r?.enabled
      ? r.permissions.write.flatMap((w) => PLUGIN_MUTATORS[w as 'tasks'])
      : [];
    if (!allowed.includes(b.name)) throw new HttpError(403, 'forbidden', 'Плагину не разрешено');
    try {
      await this.core.execute(auth.userId, [{ name: b.name, args: b.args }]);
    } catch (e) {
      // Reject from apps/api: code per the C-http table; non-mutator errors go outward as is
      const code = (e as { code?: unknown }).code;
      const m = typeof code === 'string' ? HTTP[code] : undefined;
      if (!m || e instanceof HttpError) throw e;
      throw new HttpError(m[0], m[1], (e as Error).message);
    }
  }
}
