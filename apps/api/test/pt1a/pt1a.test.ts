import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { eq, sql } from 'drizzle-orm';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { CollabService } from '../../src/collab/collab.service.js';
import { toJson } from '../../src/collab/ydoc.js';
import { fill } from '../../src/collab/ydoc.js';
import { tasks, ydocs } from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, doc, newDb, taskArgs, world } from '../sync/helpers.js';
import type { World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let port: number;
let svc: CollabService;
const cookies: Record<string, string> = {};
const providers: HocuspocusProvider[] = [];

beforeAll(async () => {
  w = await world(db);
  process.env.COLLAB_DEBOUNCE_MS = '100';
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  svc = app.get(CollabService);
  for (const u of ['admin', 'member', 'guest', 'outsider'] as const)
    cookies[u] = await loginCookie(db, w[u].userId);
});
afterAll(async () => {
  for (const p of providers) p.destroy();
  await app.close();
  await db.$client.end();
});

const until = async (fn: () => unknown, ms = 3000) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* wait */
    }
    if (Date.now() - t0 > ms) throw new Error('не дождались');
    await new Promise((r) => setTimeout(r, 10));
  }
};

function open(user: keyof typeof cookies, name: string) {
  const headers = { cookie: cookies[user]!, origin: ORIGIN };
  class WS extends WebSocket {
    constructor(url: string) {
      super(url, { headers });
    }
  }
  const document = new Y.Doc();
  const state = { failed: false, synced: false };
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}/collab`,
    name,
    document,
    token: 'x',
    WebSocketPolyfill: WS as never,
    onAuthenticationFailed: () => (state.failed = true),
    onSynced: () => (state.synced = true),
  });
  providers.push(provider);
  return { document, provider, state };
}

const addParagraph = (d: Y.Doc, text: string) => {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  d.getXmlFragment('default').insert(d.getXmlFragment('default').length, [p]);
};
const has = (d: Y.Doc, text: string) => JSON.stringify(toJson(d)).includes(text);

const mkPage = async (body: object = doc('start')) => {
  const id = uuidv7();
  await w.member.ok('docs.page.create', { id, spaceId: w.spaceId, rank: 'a0', body });
  return id;
};
const mkTask = async (description?: object) => {
  const a = taskArgs(w, description ? { description } : {});
  await w.member.ok('task.create', a);
  return a.id;
};
const page = async (id: string) =>
  (await db.execute(sql`select body, text, files, updated_by from docs_pages where id = ${id}`))
    .rows[0] as { body: object; text: string; files: string[]; updated_by: string };
const ydoc = async (name: string) =>
  (await db.select().from(ydocs).where(eq(ydocs.docId, name)))[0];

describe('pt1a', () => {
  it('pt1a: схема — JSON с заголовком, списком, картинкой и упоминанием проходит через Y.Doc без потерь', async () => {
    const { normalize } = await import('../../src/collab/ydoc.js');
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Заголовок' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'жирный' },
                    { type: 'mention', attrs: { id: uuidv7(), label: 'Иван' } },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'image', attrs: { src: '/files/' + 'a'.repeat(64), alt: 'x' } },
      ],
    };
    const y = new Y.Doc();
    fill(y, json);
    expect(toJson(y)).toEqual(normalize(json));
    expect(JSON.stringify(toJson(y))).toContain('Иван');
  });

  it('pt1a: два провайдера docs:<id> — правка видна другому ≤ 500 мс', async () => {
    const id = await mkPage();
    const a = open('member', `docs:${id}`);
    const b = open('admin', `docs:${id}`);
    await until(() => a.state.synced && b.state.synced);
    const t0 = Date.now();
    addParagraph(a.document, 'привет');
    await until(() => has(b.document, 'привет'), 500);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('pt1a: два провайдера task:<id> — правка видна другому ≤ 500 мс', async () => {
    const id = await mkTask();
    const a = open('member', `task:${id}`);
    const b = open('admin', `task:${id}`);
    await until(() => a.state.synced && b.state.synced);
    addParagraph(b.document, 'описание');
    await until(() => has(a.document, 'описание'), 500);
  });

  it('pt1a: не участник пространства — отказ, документ не загружается', async () => {
    const id = await mkPage();
    const o = open('outsider', `docs:${id}`);
    await until(() => o.state.failed);
    expect(o.state.synced).toBe(false);
    expect(svc.hp.documents.has(`docs:${id}`)).toBe(false);
    const bad = open('member', 'other:' + id);
    await until(() => bad.state.failed);
  });

  it('pt1a: нет cookie или чужой Origin — upgrade отклонён', async () => {
    const status = (headers: Record<string, string>) =>
      new Promise<number>((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/collab`, { headers });
        ws.on('unexpected-response', (_q, r) => res(r.statusCode!));
        ws.on('open', () => res(101));
        ws.on('error', () => {});
      });
    expect(await status({ origin: ORIGIN })).toBe(401);
    expect(await status({ cookie: cookies.member!, origin: 'http://evil.example' })).toBe(403);
    expect(await status({ cookie: cookies.member!, origin: ORIGIN })).toBe(101);
  });

  it('pt1a: guest — readOnly, его правка не применяется', async () => {
    const id = await mkPage();
    const m = open('member', `docs:${id}`);
    const g = open('guest', `docs:${id}`);
    await until(() => m.state.synced && g.state.synced);
    addParagraph(g.document, 'гостевая');
    await new Promise((r) => setTimeout(r, 300));
    expect(has(m.document, 'гостевая')).toBe(false);
    addParagraph(m.document, 'участник');
    await until(() => has(g.document, 'участник'), 500);
  });

  it('pt1a: первое открытие строит Y.Doc из существующего body и сохраняет базу', async () => {
    const id = await mkPage(doc('исходный текст'));
    expect(await ydoc(`docs:${id}`)).toBeUndefined();
    const a = open('member', `docs:${id}`);
    await until(() => a.state.synced);
    expect(has(a.document, 'исходный текст')).toBe(true);
    expect(await ydoc(`docs:${id}`)).toBeDefined();
  });

  it('pt1a: после debounce обновлены body, text, files и строка changes', async () => {
    const sha = 'b'.repeat(64);
    const id = await mkPage();
    const a = open('member', `docs:${id}`);
    await until(() => a.state.synced);
    const img = new Y.XmlElement('image');
    img.setAttribute('src', `/files/${sha}`);
    a.document.getXmlFragment('default').insert(0, [img]);
    addParagraph(a.document, 'уникальноеслово');
    await until(async () => (await page(id)).text.includes('уникальноеслово'));
    const p = await page(id);
    expect(p.files).toEqual([sha]);
    expect(p.updated_by).toBe(w.member.userId);
    const c = await db.execute(
      sql`select 1 from changes where entity = 'docsPages' and id = ${id} and data::text like '%уникальноеслово%'`,
    );
    expect(c.rows.length).toBeGreaterThan(0);
    expect((await ydoc(`docs:${id}`))!.state.length).toBeGreaterThan(0);
  });

  it('pt1a: tasks.description обновляется проекцией', async () => {
    const id = await mkTask();
    const a = open('member', `task:${id}`);
    await until(() => a.state.synced);
    addParagraph(a.document, 'сделать');
    await until(async () => {
      const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
      return JSON.stringify(t!.description).includes('сделать');
    });
  });

  it('pt1a: внешняя запись при открытом документе заменяет содержимое; при закрытом — удаляет ydocs', async () => {
    const id = await mkPage(doc('старое'));
    const a = open('member', `docs:${id}`);
    await until(() => a.state.synced);
    await w.admin.ok('docs.page.update', { id, body: doc('внешнее') });
    await until(() => has(a.document, 'внешнее') && !has(a.document, 'старое'), 1500);
    // the projection did not loop: the body stayed external
    await new Promise((r) => setTimeout(r, 400));
    expect(JSON.stringify((await page(id)).body)).toContain('внешнее');

    const id2 = await mkPage(doc('одно'));
    const b = open('member', `docs:${id2}`);
    await until(() => b.state.synced);
    addParagraph(b.document, 'два');
    await until(async () => (await page(id2)).text.includes('два'));
    b.provider.destroy();
    await until(() => !svc.hp.documents.has(`docs:${id2}`));
    expect(await ydoc(`docs:${id2}`)).toBeDefined(); // our own ydocs projection does not erase it
    await w.admin.ok('docs.page.update', { id: id2, body: doc('другое') });
    await until(async () => !(await ydoc(`docs:${id2}`)));
  });

  it('pt1a: правка заголовка при открытом документе не откатывает несохранённый набор', async () => {
    const id = await mkPage(doc('база'));
    const a = open('member', `docs:${id}`);
    await until(() => a.state.synced);
    addParagraph(a.document, 'набранное');
    await w.admin.ok('docs.page.update', { id, title: 'Новый заголовок' });
    await new Promise((r) => setTimeout(r, 600));
    expect(has(a.document, 'набранное')).toBe(true);
    await until(async () => (await page(id)).text.includes('набранное'));
  });

  it('pt1a: task.delete удаляет ydocs и закрывает соединения', async () => {
    const id = await mkTask();
    const a = open('member', `task:${id}`);
    await until(() => a.state.synced);
    addParagraph(a.document, 'x');
    await until(async () => ydoc(`task:${id}`));
    await w.admin.ok('task.delete', { id });
    await until(async () => !(await ydoc(`task:${id}`)));
    await until(() => !svc.hp.documents.has(`task:${id}`));
    await new Promise((r) => setTimeout(r, 300));
    expect(await ydoc(`task:${id}`)).toBeUndefined();
  });

  it('pt1a: удаление из пространства закрывает соединение', async () => {
    const id = await mkPage();
    const a = open('guest', `docs:${id}`);
    await until(() => a.state.synced);
    const name = `docs:${id}`;
    expect(svc.hp.documents.get(name)!.getConnectionsCount()).toBe(1);
    const rows = (await w.admin.bootstrap()).data as Record<
      string,
      { id: string; userId: string }[]
    >;
    const m = rows.spaceMembers!.find((r) => r.userId === w.guest.userId)!;
    await w.admin.ok('member.remove', { id: m.id });
    await until(() => !svc.hp.documents.get(name)?.getConnectionsCount());
  });

  it('pt1a: понижение member -> guest закрывает соединение', async () => {
    const id = await mkPage();
    const name = `docs:${id}`;
    const a = open('member', name);
    await until(() => a.state.synced);
    expect(svc.hp.documents.get(name)!.getConnectionsCount()).toBe(1);
    const rows = (await w.admin.bootstrap()).data as Record<
      string,
      { id: string; userId: string }[]
    >;
    const m = rows.spaceMembers!.find((r) => r.userId === w.member.userId)!;
    await w.admin.ok('member.update', { id: m.id, role: 'guest' });
    await until(() => !svc.hp.documents.get(name)?.getConnectionsCount());
    await w.admin.ok('member.update', { id: m.id, role: 'member' });
  });

  it('pt1a: архивирование страницы и выключение модуля docs закрывают открытые соединения', async () => {
    const id = await mkPage();
    const name = `docs:${id}`;
    const a = open('member', name);
    await until(() => a.state.synced);
    await w.admin.ok('docs.page.archive', { id });
    await until(() => !svc.hp.documents.get(name)?.getConnectionsCount());

    // PJ-3: docs is switched off in the page's project
    const id2 = uuidv7();
    await w.member.ok('docs.page.create', {
      id: id2,
      spaceId: w.spaceId,
      projectId: w.projectId,
      rank: 'a0',
      body: doc('start'),
    });
    const name2 = `docs:${id2}`;
    const b = open('member', name2);
    await until(() => b.state.synced);
    const set = (enabled: boolean) =>
      w.admin.ok('project.setModule', { projectId: w.projectId, moduleId: 'docs', enabled });
    await set(false);
    try {
      await until(() => !svc.hp.documents.get(name2)?.getConnectionsCount());
    } finally {
      await set(true);
    }
  });
});
