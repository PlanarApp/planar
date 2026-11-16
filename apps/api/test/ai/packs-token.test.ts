// PLNRAPP-269 (CA-4): packs and event bindings with an API token (REST + MCP tools); secret settings stay session-only.
import { beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { aiPackTools } from '@planar/module-ai/api';
import { CORE } from '@planar/server-kit';
import { loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { world, type World } from '../sync/helpers.js';

useApp();

let w: World;
const bearer: Record<string, string> = {};

const issue = async (userId: string, scope: 'read' | 'write') => {
  const r = await getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: await loginCookie(db, userId), origin: ORIGIN },
      payload: { name: 't', scope },
    });
  return `Bearer ${apiTokenCreatedSchema.parse(r.json()).secret}`;
};
const call = (method: 'GET' | 'POST', url: string, who: string, body?: object) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url, payload: body, headers: { authorization: bearer[who]! } });

beforeAll(async () => {
  w = await world(db);
  bearer.adminWrite = await issue(w.admin.userId, 'write');
  bearer.adminRead = await issue(w.admin.userId, 'read');
  bearer.memberWrite = await issue(w.member.userId, 'write');
});

describe('пакеты и привязки событий с токеном', () => {
  const body = () => ({ projectId: w.projectId, packKey: 'dev' });

  it('токен write админа: список, загрузка, привязки событий', async () => {
    expect(
      (await call('GET', `/api/ai/packs?projectId=${w.projectId}`, 'adminWrite')).statusCode,
    ).toBe(200);
    const up = await call('POST', '/api/ai/packs/upload', 'adminWrite', body());
    expect(up.statusCode).toBe(200);
    const h = { projectId: w.projectId, packPageId: up.json().rootPageId };
    expect((await call('POST', '/api/ai/harness/diff', 'adminWrite', h)).statusCode).toBe(200);
    // the actions of the pack exist in the project only after apply
    expect((await call('POST', '/api/ai/harness/apply', 'adminWrite', h)).statusCode).toBe(200);
    const ev = await call('POST', '/api/ai/packs/events', 'adminWrite', {
      ...body(),
      events: { comment: 'assign' },
    });
    expect(ev.statusCode).toBe(200);
  });

  it('токен read — чтение можно, запись 403; участник с write — 403', async () => {
    expect(
      (await call('GET', `/api/ai/packs?projectId=${w.projectId}`, 'adminRead')).statusCode,
    ).toBe(200);
    expect((await call('POST', '/api/ai/packs/upload', 'adminRead', body())).statusCode).toBe(403);
    expect((await call('POST', '/api/ai/packs/upload', 'memberWrite', body())).statusCode).toBe(
      403,
    );
    expect(
      (await call('POST', '/api/ai/packs/events', 'memberWrite', { ...body(), events: {} }))
        .statusCode,
    ).toBe(403);
  });

  it('секретные настройки ИИ по-прежнему только из сессии', async () => {
    const r = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/ai/limits?projectId=${w.projectId}`,
        headers: { authorization: bearer.adminWrite! },
      });
    expect(r.statusCode).toBe(403);
  });

  it('инструменты MCP: те же права', async () => {
    const tools = aiPackTools(getApp().get(CORE));
    const t = (n: string) => tools.find((x) => x.name === n)!;
    expect(
      tools.every((x) => x.name === 'ai_list_packs' || x.name === 'ai_diff_pack' || x.write),
    ).toBe(true);
    const dry = (await t('ai_upload_pack').run(
      { projectId: w.projectId, packKey: 'dev', dryRun: true } as never,
      w.admin.userId,
    )) as { conflicts: unknown[] };
    expect(dry.conflicts).toEqual([]);
    await expect(
      t('ai_upload_pack').run({ projectId: w.projectId, packKey: 'dev' } as never, w.member.userId),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      t('ai_list_packs').run({ projectId: uuidv7() } as never, w.admin.userId),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
