import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { tasks } from '../../src/db/schema.js';
import { JobsService } from '../../src/jobs/jobs.js';
import { createUser, loginCookie } from '../auth.js';
import { db, getApp, req, useApp } from '../auth/harness.js';
import { world } from '../sync/helpers.js';

// тестовый контроллер «модуля»: ядро только через CORE
@Controller('api/_wk10')
class Probe {
  constructor(@Inject(CORE) private core: CoreServices) {}
  @Get('me')
  me(@Req() r: object) {
    return this.core.auth(r);
  }
  @Get('admin')
  admin(@Req() r: object) {
    return this.core.requireInstanceAdmin(r);
  }
  @Get('admin-session')
  adminSession(@Req() r: object) {
    return this.core.requireInstanceAdmin(r, { sessionOnly: true });
  }
  @Get('task/:id')
  async task(@Param('id') id: string) {
    const rows = await this.core.db.select().from(tasks).where(eq(tasks.id, id));
    return { data: (await this.core.toV1Tasks(this.core.db, rows))[0] };
  }
  @Get('boom')
  boom() {
    throw new HttpError(409, 'conflict', 'занято');
  }
  @Post('body')
  body(@Body() b: unknown) {
    return parseBody(z.object({ n: z.number() }), b);
  }
  @Get('sys')
  sys() {
    return { id: this.core.systemUserId() };
  }
}

useApp({ extraControllers: [Probe] });
const get = (url: string, headers: Record<string, string> = {}) =>
  getApp().getHttpAdapter().getInstance().inject({ method: 'GET', url, headers });

async function bearer(cookie: string): Promise<string> {
  const r = await req('POST', '/api/tokens', { cookie, body: { name: 't', scope: 'write' } });
  return `Bearer ${r.json().secret}`;
}

describe('wk10:', () => {
  it('wk10: модуль через CORE: 401 без входа, auth отдаёт пользователя и роль', async () => {
    expect((await get('/api/_wk10/me')).statusCode).toBe(401);
    const u = await createUser(db, { role: 'member' });
    const r = await get('/api/_wk10/me', { cookie: await loginCookie(db, u.id) });
    expect(r.json()).toEqual({ userId: u.id, role: 'member', tokenId: null, tokenScope: null });
  });

  it('wk10: requireInstanceAdmin: member → 403, admin → ok; Bearer при sessionOnly → 403', async () => {
    const m = await loginCookie(db, (await createUser(db, { role: 'member' })).id);
    expect((await get('/api/_wk10/admin', { cookie: m })).statusCode).toBe(403);
    const a = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
    expect((await get('/api/_wk10/admin', { cookie: a })).statusCode).toBe(200);
    expect((await get('/api/_wk10/admin-session', { cookie: a })).statusCode).toBe(200);
    const b = await bearer(a);
    expect((await get('/api/_wk10/admin-session', { authorization: b })).statusCode).toBe(403);
    const ok = await get('/api/_wk10/admin', { authorization: b });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tokenScope).toBe('write');
  });

  it('wk10: toV1Tasks даёт ту же форму, что REST GET /api/v1/tasks/:id', async () => {
    const w = await world(db);
    const id = uuidv7();
    await w.admin.ok('task.create', {
      id,
      projectId: w.projectId,
      statusId: w.statusIds[1],
      title: 'T',
      rank: 'a0',
    });
    const cookie = await loginCookie(db, w.admin.userId);
    const rest = (await get(`/api/v1/tasks/${id}`, { cookie })).json().data;
    const kit = (await get(`/api/_wk10/task/${id}`, { cookie })).json().data;
    expect(kit).toEqual(rest);
    expect(kit).toMatchObject({ assigneeIds: [], labelIds: [] });
    expect(kit.key).toMatch(/-\d+$/);
  });

  it('wk10: HttpError и parseBody из kit отдают формат C-http', async () => {
    const c = await loginCookie(db, (await createUser(db)).id);
    const e = await get('/api/_wk10/boom', { cookie: c });
    expect(e.statusCode).toBe(409);
    expect(e.json()).toEqual({ code: 'conflict', message: 'занято' });
    const b = await req('POST', '/api/_wk10/body', { cookie: c, body: { n: 'x' } });
    expect(b.statusCode).toBe(400);
    expect(b.json()).toMatchObject({ code: 'invalid_request' });
    expect(b.json().details).toBeInstanceOf(Array);
  });

  it('wk10: systemUserId доступен модулю', async () => {
    const c = await loginCookie(db, (await createUser(db)).id);
    expect((await get('/api/_wk10/sys', { cookie: c })).json().id).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe('execute prepare', () => {
    const mk = async () => {
      const w = await world(db);
      const id = uuidv7();
      await w.admin.ok('task.create', {
        id,
        projectId: w.projectId,
        statusId: w.statusIds[1],
        title: 'orig',
        rank: 'a0',
      });
      const api = await getApp().get(JobsService).api();
      const title = async () => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!.title;
      return { w, id, api, title };
    };

    it('wk10: prepare=false не выполняет мутации', async () => {
      const { w, id, api, title } = await mk();
      let seen = false;
      await api.execute(w.admin.userId, [{ name: 'task.update', args: { id, title: 'new' } }], {
        system: true,
        prepare: async () => {
          seen = true;
          return false;
        },
      });
      expect(seen).toBe(true);
      expect(await title()).toBe('orig');
    });

    it('wk10: after видит результат мутаций; ошибка after откатывает всё', async () => {
      const { w, id, api, title } = await mk();
      const mut = [{ name: 'task.update', args: { id, title: 'new' } }];
      let seen = '';
      await api.execute(w.admin.userId, mut, {
        system: true,
        after: async (q) => {
          const r = await q.execute(sql`select title from tasks where id = ${id}`);
          seen = (r.rows[0] as { title: string }).title;
        },
      });
      expect(seen).toBe('new');
      await expect(
        api.execute(w.admin.userId, [{ name: 'task.update', args: { id, title: 'again' } }], {
          system: true,
          after: async () => {
            throw new Error('boom');
          },
        }),
      ).rejects.toThrow('boom');
      expect(await title()).toBe('new');
    });

    it('wk10: prepare и мутации — одна транзакция', async () => {
      const { w, id, api, title } = await mk();
      const prep = (
        q: Parameters<NonNullable<Parameters<typeof api.execute>[2]>['prepare'] & {}>[0],
      ) => q.execute(sql`update tasks set title = 'prepared' where id = ${id}`).then(() => {});
      // мутация падает → откатывается и запись prepare
      await expect(
        api.execute(w.admin.userId, [{ name: 'task.update', args: { id: uuidv7(), title: 'x' } }], {
          system: true,
          prepare: prep,
        }),
      ).rejects.toThrow();
      expect(await title()).toBe('orig');
      // успех: оба изменения на месте
      await api.execute(w.admin.userId, [{ name: 'task.update', args: { id, priority: 2 } }], {
        system: true,
        prepare: prep,
      });
      expect(await title()).toBe('prepared');
    });
  });
});
