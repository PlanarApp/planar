// PLNRAPP-169 (AIH-3): packs of the harness — catalog → project docs, hashes, re-upload, activate, export, reset.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { readCatalogPack, unzipFiles, zipFiles } from '@planar/module-ai/api';
import {
  instructionBody,
  plainText,
  readInstructionPage,
} from '../../../../modules/ai/api/packs.js';
import { aiHarnessPacks as P } from '@planar/module-ai/api/schema';
import { parseHarnessYaml, parseInstructionDoc } from '@planar/module-ai/shared';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { world, type World } from '../sync/helpers.js';

useApp();

let w: World;
let srv: http.Server;
let base: string;
let llmReplies = 0;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = randomBytes(32).toString('base64');
  w = await world(db);
  cookies.admin = await loginCookie(db, w.admin.userId);
  cookies.member = await loginCookie(db, w.member.userId);
  cookies.root = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  // fake OpenAI-compatible provider: always «merged» text
  srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      llmReplies++;
      const merged = JSON.stringify({ merged: '---\nname: Слитая\n---\n\nСлитый промпт.\n' });
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'fake',
          choices: [
            { index: 0, message: { role: 'assistant', content: merged }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => void srv.close());

const call = (method: string, url: string, who: string, body?: unknown) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/ai/${url}`,
      payload: body as object | undefined,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const up = (projectId: string, over: Record<string, unknown> = {}) =>
  call('POST', 'packs/upload', 'admin', { projectId, packKey: 'dev', ...over });
const b64 = (files: Record<string, string>) => zipFiles(files).toString('base64');

type Page = {
  id: string;
  title: string;
  parent_id: string | null;
  archived_at: string | null;
  body: unknown;
};
const pages = async (projectId: string) =>
  (
    await db.execute(
      sql`select id, title, parent_id, archived_at, body from docs_pages where project_id = ${projectId}::uuid`,
    )
  ).rows as Page[];
const textOf = (n: unknown): string => {
  const o = n as { text?: string; content?: unknown[] };
  return o.text ?? (o.content ?? []).map(textOf).join('');
};

describe('packs', () => {
  it('пакет dev из каталога разбирается и содержит только llm-действия', async () => {
    const files = (await readCatalogPack('dev'))!;
    const h = parseHarnessYaml(files['harness.yml']!);
    expect(h.actions).toEqual(['plan', 'decompose', 'triage', 'discussion', 'assign', 'chat']);
    expect(h.fields).toEqual([{ key: 'budget', name: 'Бюджет', type: 'number' }]);
    expect(h.settings.questionStatus).toBe('clarify');
    expect(h.rules.every((r) => (r.filter as { assignee: string[] }).assignee[0] === 'ai')).toBe(
      true,
    );
    for (const k of h.actions) {
      const i = parseInstructionDoc(files[`actions/${k}.md`]!);
      expect(i.runtime, k).toBe('llm');
      expect(i.prompt, k).not.toBe('');
    }
    expect(parseInstructionDoc(files['actions/plan.md']!).prompt).toContain('«Бюджет»');
  });

  it('загрузка раскладывает документы, пишет хеши; активация и права', async () => {
    const l = (await call('GET', `packs?projectId=${w.projectId}`, 'admin')).json();
    expect(l.catalog).toEqual(
      expect.arrayContaining([{ key: 'dev', title: 'Разработка', actions: 6 }]),
    );
    expect(
      l.catalog
        .map((c: { key: string }) => c.key)
        .filter((k: string) => !['dev', 'sales', 'hiring', 'support'].includes(k)),
    ).toEqual([]);
    expect(l.packs).toEqual([]);

    expect((await call('GET', `packs?projectId=${w.projectId}`, 'member')).statusCode).toBe(403);
    expect((await up(uuidv7())).statusCode).toBe(404);
    expect((await up(w.projectId, { packKey: 'nope' })).statusCode).toBe(404);
    expect((await up(w.projectId, { zip: 'bm90IGEgemlw' })).statusCode).toBe(400);

    const r = await up(w.projectId);
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.status).toBe('ok');
    expect(j.created).toHaveLength(7);

    const ps = await pages(w.projectId);
    const container = ps.find((p) => p.title === 'Harness-пакеты')!;
    const root = ps.find((p) => p.id === j.rootPageId)!;
    expect(root).toMatchObject({ title: 'Разработка', parent_id: container.id });
    expect(textOf(root.body)).toContain('statuses:');
    const kids = ps.filter((p) => p.parent_id === root.id);
    expect(kids.map((k) => k.title).sort()).toEqual(
      ['Декомпозиция', 'Планирование', 'Поручение', 'Сводка обсуждения', 'Триаж', 'Чат'].sort(),
    );
    const plan = kids.find((k) => k.title === 'Планирование')!;
    expect(textOf(plan.body)).toContain('Параметр');
    expect(textOf(plan.body)).toContain('Бюджет');

    const [row] = await db.select().from(P).where(eq(P.projectId, w.projectId));
    expect(row).toMatchObject({ packKey: 'dev', active: false, rootPageId: root.id });
    expect(Object.keys(row!.hashes).sort()).toEqual([root.id, ...kids.map((k) => k.id)].sort());
    expect(Object.values(row!.hashes).every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);

    expect(
      (await call('POST', 'packs/activate', 'member', { projectId: w.projectId, packKey: 'dev' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', 'packs/activate', 'admin', { projectId: w.projectId, packKey: 'x' }))
        .statusCode,
    ).toBe(404);
    const a = await call('POST', 'packs/activate', 'admin', {
      projectId: w.projectId,
      packKey: 'dev',
    });
    expect(a.json()).toMatchObject({ packKey: 'dev', active: true, warnings: [] });
  });

  it('повторная загрузка без изменений не меняет ничего; правки человека остаются', async () => {
    const before = await db.select().from(P).where(eq(P.projectId, w.projectId));
    const r = (await up(w.projectId)).json();
    expect(r).toMatchObject({ status: 'ok', created: [], updated: [], kept: [] });
    expect((await db.select().from(P).where(eq(P.projectId, w.projectId)))[0]!.hashes).toEqual(
      before[0]!.hashes,
    );

    // the user edits «Чат»; the pack did not change — the edit stays, no conflict
    const chat = (await pages(w.projectId)).find((p) => p.title === 'Чат')!;
    const body = JSON.parse(JSON.stringify(chat.body)) as { content: unknown[] };
    body.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Мой чат.' }] });
    await w.admin.ok('docs.page.update', { id: chat.id, body });
    expect((await up(w.projectId)).json()).toMatchObject({
      status: 'ok',
      created: [],
      updated: [],
      kept: ['chat'],
    });
    expect(textOf((await pages(w.projectId)).find((p) => p.id === chat.id)!.body)).toContain(
      'Мой чат.',
    );
    // return it to the pack so that the next steps see only their own edits
    expect((await up(w.projectId, { resolve: {} })).json().status).toBe('ok');
    await w.admin.ok('docs.page.update', { id: chat.id, body: chat.body });
  });

  it('изменённый пакет: чужие страницы обновляются, тронутые человеком — конфликт; reset / keep / merge', async () => {
    const files = { ...(await readCatalogPack('dev'))! };
    const plan = files['actions/plan.md']!;
    const triage = files['actions/triage.md']!;
    files['actions/plan.md'] = plan.replace('Проверь задачу', 'Новая проверка задачи');
    files['actions/triage.md'] = triage.replace(
      'Разбери новую задачу.',
      'Разбери задачу по-новому.',
    );
    const zip = b64(files);

    // the user changes «Планирование» (the prompt)
    const ps = await pages(w.projectId);
    const planPage = ps.find((p) => p.title === 'Планирование')!;
    const body = JSON.parse(JSON.stringify(planPage.body)) as {
      content: { type: string; content?: { text?: string }[] }[];
    };
    body.content.push({
      type: 'paragraph',
      content: [{ text: 'Моя правка.', type: 'text' } as never],
    });
    await w.admin.ok('docs.page.update', { id: planPage.id, body });

    const c = (await up(w.projectId, { zip })).json();
    expect(c.status).toBe('conflict');
    expect(c.conflicts).toEqual([{ key: 'plan', pageId: planPage.id, title: 'Планирование' }]);
    // nothing written on a conflict
    expect(
      textOf((await pages(w.projectId)).find((p) => p.id === planPage.id)!.body),
    ).not.toContain('Новая проверка');
    expect(textOf((await pages(w.projectId)).find((p) => p.title === 'Триаж')!.body)).not.toContain(
      'по-новому',
    );

    // merge: the AI text is shown, nothing is written
    await call('PUT', 'connections', 'root', {
      scope: 'instance',
      provider: 'openai-compatible',
      baseUrl: base,
      apiKey: 'sk-test',
      model: 'fake',
    });
    llmReplies = 0;
    const m = (
      await call('POST', 'packs/merge', 'admin', {
        projectId: w.projectId,
        packKey: 'dev',
        zip,
        key: 'plan',
      })
    ).json();
    expect(llmReplies).toBe(1);
    expect(m.merged).toContain('Слитый промпт');
    expect(m.current).toContain('Моя правка.');
    expect(m.incoming).toContain('Новая проверка задачи');
    expect(
      (
        await call('POST', 'packs/merge', 'admin', {
          projectId: w.projectId,
          packKey: 'dev',
          zip,
          key: 'triage',
        })
      ).statusCode,
    ).toBe(409);

    // keep: the page stays, the untouched «Триаж» follows the pack; the next upload does not ask again
    const k = (await up(w.projectId, { zip, resolve: { plan: 'keep' } })).json();
    expect(k).toMatchObject({ status: 'ok', kept: ['plan'], updated: ['triage'] });
    const after = await pages(w.projectId);
    expect(textOf(after.find((p) => p.id === planPage.id)!.body)).toContain('Моя правка.');
    expect(textOf(after.find((p) => p.title === 'Триаж')!.body)).toContain('по-новому');
    expect((await up(w.projectId, { zip })).json()).toMatchObject({ status: 'ok', updated: [] });

    // a still newer pack: merged text is written on confirmation
    files['actions/plan.md'] = plan.replace('Проверь задачу', 'Ещё новее');
    const zip2 = b64(files);
    expect((await up(w.projectId, { zip: zip2 })).json().status).toBe('conflict');
    const bad = await up(w.projectId, {
      zip: zip2,
      resolve: { plan: { merged: 'без frontmatter' } },
    });
    expect(bad.statusCode).toBe(400);
    const mg = (
      await up(w.projectId, { zip: zip2, resolve: { plan: { merged: m.merged } } })
    ).json();
    expect(mg).toMatchObject({ status: 'ok', updated: ['plan'] });
    const merged = (await pages(w.projectId)).find((p) => p.id === planPage.id)!;
    expect(merged.title).toBe('Слитая');
    expect(textOf(merged.body)).toContain('Слитый промпт.');

    // reset: back to the pack
    files['actions/plan.md'] = plan.replace('Проверь задачу', 'Третья версия');
    const zip3 = b64(files);
    const mb = JSON.parse(JSON.stringify(merged.body)) as { content: unknown[] };
    mb.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Моя правка.' }] });
    await w.admin.ok('docs.page.update', { id: planPage.id, body: mb });
    expect((await up(w.projectId, { zip: zip3 })).json().status).toBe('conflict');
    const rs = (await up(w.projectId, { zip: zip3, resolve: { plan: 'reset' } })).json();
    expect(rs).toMatchObject({ status: 'ok', updated: ['plan'] });
    const reset = (await pages(w.projectId)).find((p) => p.id === planPage.id)!;
    expect(reset.title).toBe('Планирование');
    expect(textOf(reset.body)).toContain('Третья версия');
    expect(textOf(reset.body)).not.toContain('Моя правка');
  });

  it('экспорт → импорт: круг даёт те же файлы и те же хеши', async () => {
    const e = await call('GET', `packs/export?projectId=${w.projectId}&packKey=dev`, 'admin');
    expect(e.statusCode).toBe(200);
    expect(e.headers['content-type']).toBe('application/zip');
    const files = unzipFiles(e.rawPayload);
    expect(Object.keys(files).sort()).toEqual(
      [
        'harness.yml',
        ...parseHarnessYaml(files['harness.yml']!).actions.map((k) => `actions/${k}.md`),
      ].sort(),
    );
    expect(parseInstructionDoc(files['actions/plan.md']!).prompt).toContain('Третья версия');

    // into another project of the space, under another key
    const p2 = uuidv7();
    await w.admin.ok('project.create', {
      id: p2,
      spaceId: w.spaceId,
      name: 'P2',
      key: 'PTWO',
      rank: 'b0',
    });
    const r = await up(p2, {
      packKey: 'dev2',
      zip: e.rawPayload.toString('base64'),
      title: 'Копия',
    });
    expect(r.json()).toMatchObject({ status: 'ok' });
    const again = await call('GET', `packs/export?projectId=${p2}&packKey=dev2`, 'admin');
    expect(unzipFiles(again.rawPayload)).toEqual(files);
    const [a] = await db.select().from(P).where(eq(P.projectId, w.projectId));
    const [b] = await db.select().from(P).where(eq(P.projectId, p2));
    expect(Object.values(b!.hashes).sort()).toEqual(Object.values(a!.hashes).sort());
    // the zip of a folder (one top-level directory) is accepted too
    const nested = Object.fromEntries(Object.entries(files).map(([k, v]) => [`dev/${k}`, v]));
    expect(unzipFiles(zipFiles(nested))).toEqual(files);
    // unsafe paths
    expect(() => unzipFiles(zipFiles({ '../x': 'a' }))).toThrow(/путь/);
  });

  it('удаление документов пакета сбрасывает активный, правила отключаются, пользователь получает предупреждение', async () => {
    const [row] = await db.select().from(P).where(eq(P.projectId, w.projectId));
    expect(row!.active).toBe(true);
    const ruleId = uuidv7();
    await w.admin.ok('automations.create', {
      id: ruleId,
      projectId: w.projectId,
      name: 'Правило пакета',
      trigger: { type: 'task.created' },
      actions: [{ type: 'add_comment', text: 'x' }],
    });
    await db.execute(
      sql`insert into ai_harness_keys (id, project_id, kind, key, entity_id) values (${uuidv7()}::uuid, ${w.projectId}::uuid, 'rule', 'r', ${ruleId}::uuid)`,
    );
    await w.admin.ok('docs.page.archive', { id: row!.rootPageId });

    const l = (await call('GET', `packs?projectId=${w.projectId}`, 'admin')).json();
    expect(l.warnings).toHaveLength(1);
    expect(l.warnings[0]).toContain('dev');
    expect(l.packs.find((p: { packKey: string }) => p.packKey === 'dev')).toMatchObject({
      active: false,
      rootPageId: null,
    });
    expect((await db.select().from(P).where(eq(P.id, row!.id)))[0]!.active).toBe(false);
    const rule = (
      await db.execute(sql`select enabled from automations_rules where id = ${ruleId}::uuid`)
    ).rows[0];
    expect(rule).toEqual({ enabled: false });
    // a second look has nothing to warn about; activation of a pack without documents is refused
    expect((await call('GET', `packs?projectId=${w.projectId}`, 'admin')).json().warnings).toEqual(
      [],
    );
    expect(
      (await call('POST', 'packs/activate', 'admin', { projectId: w.projectId, packKey: 'dev' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('GET', `packs/export?projectId=${w.projectId}&packKey=dev`, 'admin')).statusCode,
    ).toBe(404);
    // uploading again lays the pack out anew
    expect((await up(w.projectId)).json()).toMatchObject({ status: 'ok' });
  });
});

describe('packs: yml-страница ↔ Instruction (markdown round-trip)', () => {
  it('многострочный промпт со списками, заголовками и блоком --- возвращается как был', () => {
    const prompt = [
      '# Цель',
      '',
      'Первая строка абзаца',
      'и вторая строка.',
      '',
      '## Шаги',
      '',
      '- пункт один',
      '- пункт два',
      '',
      '1. первый',
      '2. второй',
      '',
      '---',
      '',
      'Текст после разделителя.',
    ].join('\n');
    const i = {
      name: 'Разбор',
      description: 'Короткое описание',
      runtime: 'llm' as const,
      model: 'gpt-x',
      checks: ['проверка один', 'проверка два'],
      prompt,
    };
    const body = instructionBody('triage', i);
    // the page text feeds docs_pages.text: it must not choke on the nodes
    expect(plainText(body)).toContain('Текст после разделителя.');
    expect(readInstructionPage(i.name, body)).toEqual({ key: 'triage', i });
  });
});
