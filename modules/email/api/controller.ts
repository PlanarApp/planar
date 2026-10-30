import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  Req,
  Res,
  SetMetadata,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { encrypt, secretKey } from './crypto.js';
import { esc, loadCfg, parseUnsub, safeErr, send, type Mail } from './mail.js';
import { emailConfig as C } from './schema.js';

// the same as core's @Public() (apps/api/src/auth/public.ts): the module does not import apps/api
const Public = () => SetMetadata('planar:public', true);

const ADDR = '[^\\s<>@,;"]+@[^\\s<>@,;"]+';
// one RFC 5322 entry: addr or Name <addr>; CR/LF excluded (header injection)
const fromRe = new RegExp(`^(?:${ADDR}|[^<>\\r\\n,;"]+ <${ADDR}>)$`);
const putBody = z.object({
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().min(1).max(255).nullable().optional(),
  password: z.string().min(1).max(500).nullable().optional(),
  from: z.string().trim().max(320).regex(fromRe).optional(),
});
const testBody = z.object({
  to: z
    .string()
    .max(320)
    .regex(new RegExp(`^${ADDR}$`)),
});

const page = (title: string, body: string) =>
  `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
  `<body style="font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">${body}</body></html>`;
const WHAT = { notify: 'письма об уведомлениях', digest: 'ежедневный дайджест' } as const;

@Controller('api/email')
export class EmailController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  private async view() {
    const [c] = await this.core.db.select().from(C).where(eq(C.id, 'default'));
    return {
      host: c?.host ?? '',
      port: c?.port ?? 587,
      secure: c?.secure ?? false,
      username: c?.username ?? null,
      hasPassword: !!c?.passwordEnc,
      from: c?.fromAddress ?? '',
      configured: !!c?.host && !!c?.fromAddress,
    };
  }

  @Get('setup/config')
  async get(@Req() req: object) {
    this.admin(req);
    return this.view();
  }

  @Put('setup/config')
  async put(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(putBody, body);
    const set: Partial<typeof C.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (b.host !== undefined) set.host = b.host;
    if (b.port !== undefined) set.port = b.port;
    if (b.secure !== undefined) set.secure = b.secure;
    if (b.username !== undefined) set.username = b.username;
    if (b.from !== undefined) set.fromAddress = b.from;
    if (b.password !== undefined) {
      if (b.password === null) set.passwordEnc = null;
      else {
        const key = secretKey();
        if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
        set.passwordEnc = encrypt(b.password, key);
      }
    }
    await this.core.db
      .insert(C)
      .values({ id: 'default', host: '', port: 587, fromAddress: '', ...set })
      .onConflictDoUpdate({ target: C.id, set });
    return this.view();
  }

  @Post('setup/test')
  @HttpCode(200)
  async test(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(testBody, body);
    let cfg = null;
    try {
      cfg = await loadCfg(this.core.db);
      if (!cfg) throw new Error('SMTP не настроен или не задан PLANAR_SECRET_KEY');
      const m: Mail = {
        to: b.to,
        subject: 'Planar: проверка почты',
        text: 'Тестовое письмо из Planar.',
        html: '<p>Тестовое письмо из Planar.</p>',
        unsub: '',
      };
      await send(cfg, m);
    } catch (e) {
      throw new HttpError(502, 'unavailable', safeErr(e, cfg));
    }
    return { ok: true };
  }

  private token(
    t: unknown,
    res: FastifyReply,
  ): string | { userId: string; kind: 'notify' | 'digest' } {
    const key = secretKey();
    if (!key) {
      void res.status(503);
      return page('Недоступно', '<p>Отписка сейчас недоступна.</p>');
    }
    const p = parseUnsub(key, t);
    if (!p) {
      void res.status(400);
      return page('Ссылка недействительна', '<p>Ссылка недействительна.</p>');
    }
    return p;
  }

  @Public()
  @Get('unsubscribe')
  async unsubPage(@Query('t') t: unknown, @Res({ passthrough: true }) res: FastifyReply) {
    void res.header('content-type', 'text/html; charset=utf-8');
    const r = this.token(t, res);
    if (typeof r === 'string') return r;
    return page(
      'Отписка',
      `<h1>Отписаться?</h1><p>Вы перестанете получать ${WHAT[r.kind]} из Planar.</p>` +
        `<form method="post" action="?t=${esc(encodeURIComponent(String(t)))}"><button type="submit">Отписаться</button></form>`,
    );
  }

  @Public()
  @Post('unsubscribe')
  @HttpCode(200)
  async unsub(@Query('t') t: unknown, @Res({ passthrough: true }) res: FastifyReply) {
    void res.header('content-type', 'text/html; charset=utf-8');
    const r = this.token(t, res);
    if (typeof r === 'string') return r;
    const { userId, kind } = r;
    const [u] = (await this.core.db.execute(sql`select 1 from users where id = ${userId}`)).rows;
    if (!u) {
      void res.status(400);
      return page('Ссылка недействительна', '<p>Ссылка недействительна.</p>');
    }
    await this.core.execute(
      userId,
      [{ name: 'email.setPrefs', args: { id: userId, [kind]: false } }],
      {
        system: true,
      },
    );
    return page('Вы отписаны', `<p>Вы отписаны: ${WHAT[kind]}.</p>`);
  }
}
