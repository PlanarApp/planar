import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTls } from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { api as importApi } from '@planar/module-import/api';
import { htmlToDoc } from '../../../../modules/import/api/html.js';
import { createApp } from '../../src/app.js';
import { settings } from '../../src/db/schema.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { executeMutations } from '../../src/sync/mutate.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { testDb, testDbUrl } from '../db.js';
import { key, world, type World } from '../sync/helpers.js';

// PLNRAPP-874: import from the Plane API — tasks and comments with formatting
const db = testDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let adminCookie: string;
let memberCookie: string;
let plane: Server;
let planeUrl = '';
const TOKEN = 'plane_api_test';
const WS = 'acme';

const jobApi: JobApi = {
  db,
  systemUserId: '',
  execute: (u, m, o) => executeMutations(db, u, m, undefined, undefined, o),
  async enqueue() {},
};
const worker = (
  importApi.jobs as { queue: string; handler(d: unknown, a: JobApi): Promise<void> }[]
).find((j) => j.queue === 'import.run')!;

// Plane fixture: the real HTML shapes of the Plane editor, invented content
const ALICE = '11111111-1111-4111-8111-111111111111';
const GHOST = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const issue = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  sequence_id: n,
  name: `Задача ${n}`,
  description_html: `<p class="editor-paragraph-block">Текст ${n}</p>`,
  state: { name: n % 2 ? 'Todo' : 'Done' },
  assignees: [],
  labels: [],
  priority: 'none',
  start_date: null,
  target_date: null,
  parent: null,
  is_draft: false,
  archived_at: null,
  ...extra,
});
const ISSUES = [
  issue(1, {
    description_html:
      '<h3 class="editor-heading-block">Цель</h3><p class="editor-paragraph-block"><strong>Важно</strong> и <code class="rounded-sm">код</code></p><ul class="list-disc pl-7"><li><p>пункт</p></li></ul>',
    assignees: [ALICE],
    labels: ['l1'],
    priority: 'high',
    target_date: '2026-12-01',
  }),
  issue(2, { parent: issue(1).id }),
  issue(3, { is_draft: true }),
];
const COMMENTS: Record<string, unknown[]> = {
  [issue(1).id]: [
    {
      comment_html: '<p>второй</p>',
      actor: GHOST,
      created_at: '2026-11-02T10:00:00Z',
    },
    {
      comment_html: `<p class="editor-paragraph-block">Смотри <mention-component id="m1" entity_identifier="${ALICE}" entity_name="user_mention"></mention-component></p>`,
      actor: ALICE,
      created_at: '2026-11-01T09:30:00Z',
    },
  ],
};
let rateLimited = false;
let calls: string[] = [];

function handle(req: IncomingMessage, res: ServerResponse) {
  {
    const u = new URL(req.url!, 'http://x');
    calls.push(u.pathname + u.search);
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-api-key'] !== TOKEN) return send(401, { detail: 'bad key' });
    if (rateLimited) {
      rateLimited = false;
      return send(429, {}, { 'retry-after': '1' });
    }
    const p = u.pathname.replace(`/api/v1/workspaces/${WS}`, '');
    // cursor pages of 1 item: the client must follow next_cursor and never send an empty one
    const page = (all: unknown[]) => {
      if (u.searchParams.get('cursor') === '') return send(400, { detail: 'Invalid cursor' });
      const i = Number(u.searchParams.get('cursor') ?? 0);
      send(200, {
        results: all.slice(i, i + 1),
        next_cursor: String(i + 1),
        next_page_results: i + 1 < all.length,
      });
    };
    if (p === '/members/')
      return send(200, [
        { id: ALICE, display_name: 'alice.p', email: 'Alice@Example.com' },
        { id: GHOST, display_name: 'ghost', email: null },
      ]);
    if (p === '/projects/')
      return page([
        { id: P1, name: 'Engineering', identifier: 'ENG' },
        { id: P2, name: 'Secret', identifier: 'SEC' },
      ]);
    if (p === `/projects/${P2}/states/` || p.startsWith(`/projects/${P2}/`))
      return send(403, { detail: 'no' });
    if (p === `/projects/${P1}/states/`) return page([{ name: 'Todo' }, { name: 'Done' }]);
    if (p === `/projects/${P1}/labels/`) return page([{ id: 'l1', name: 'bug' }]);
    if (p === `/projects/${P1}/issues/`) {
      expect(u.searchParams.get('expand')).toBe('state');
      return page(ISSUES);
    }
    const m = /^\/projects\/[^/]+\/issues\/([^/]+)\/comments\/$/.exec(p);
    if (m) return send(200, { results: COMMENTS[m[1]!] ?? [], next_page_results: false });
    send(404, { detail: 'not found' });
  }
}

// the same Plane over https with a self-signed certificate (PLNRAPP-877)
const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures', n));
const CERT_FP =
  '15:82:E4:06:33:66:6A:93:2E:18:66:6A:E3:CB:18:B3:5D:E1:B3:00:D4:55:99:CB:2D:55:9E:CB:8A:AD:0F:9E';
let planeTls: Server;
let planeTlsUrl = '';
const listen = (srv: Server) =>
  new Promise<string>((r) =>
    srv.listen(0, '127.0.0.1', () => r(String((srv.address() as { port: number }).port))),
  );
async function startPlane() {
  plane = createServer(handle);
  planeUrl = `http://127.0.0.1:${await listen(plane)}`;
  planeTls = createTls({ key: fixture('plane-key.pem'), cert: fixture('plane-cert.pem') }, handle);
  planeTlsUrl = `https://127.0.0.1:${await listen(planeTls)}`;
}

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ['import'] })
    .onConflictDoUpdate({ target: settings.id, set: { value: ['import'] } });
  await db.$client.query(`update users set role = 'admin', email = $1 where id = $2`, [
    'alice@example.com',
    w.admin.userId,
  ]);
  app = await createApp({
    databaseUrl: testDbUrl(),
    publicUrl: ORIGIN,
    dataDir: mkdtempSync(join(tmpdir(), 'planar-plane-')),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  adminCookie = await loginCookie(db, w.admin.userId);
  memberCookie = await loginCookie(db, w.member.userId);
  await startPlane();
});
afterAll(async () => {
  plane?.close();
  planeTls?.close();
  await app.close();
  await db.$client.end();
});

function form(fields: Record<string, string>) {
  const b = '----pl' + Math.random().toString(16).slice(2);
  const body = Object.entries(fields)
    .map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    .join('');
  return { payload: `${body}--${b}--\r\n`, contentType: `multipart/form-data; boundary=${b}` };
}
const post = (url: string, cookie: string, fields: Record<string, string>) => {
  const f = form(fields);
  return app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url,
      headers: { cookie, origin: ORIGIN, 'content-type': f.contentType },
      payload: f.payload,
    });
};
const conn = (token = TOKEN) => ({
  format: 'plane-api',
  preset: 'plane',
  url: `${planeUrl}/`,
  workspace: WS,
  token,
});

describe('Plane HTML → документ', () => {
  const none = () => null;
  it('разметка редактора Plane: заголовки, отметки, списки, задачи, таблица, код, цитата, линия', () => {
    const d = htmlToDoc(
      [
        '<h2 class="editor-heading-block">H</h2>',
        '<p class="editor-paragraph-block"><strong>b</strong><em>i</em><u>u</u><s>s</s><code class="x">c</code> <a href="https://e.com" class="text-accent-secondary">link</a><br>next</p>',
        '<ol class="list-decimal"><li><p>one</p></li></ol>',
        '<ul class="not-prose" data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"><span></span></label><div><p>done</p></div></li></ul>',
        '<table data-id="t"><tbody><tr><th><p>A</p></th></tr><tr><td><p>1</p></td></tr></tbody></table>',
        '<pre class="" data-id="x"><code class="language-json">{"a":1}</code></pre>',
        '<blockquote data-id="q"><p>quote</p></blockquote>',
        '<div class="py-4" data-type="horizontalRule"><div></div></div>',
        '<p>Эмодзи <span data-name="warning" data-type="emoji">⚠</span></p>',
      ].join(''),
      none,
    )!;
    const types = (d.content as { type: string }[]).map((n) => n.type);
    expect(types).toEqual([
      'heading',
      'paragraph',
      'orderedList',
      'taskList',
      'table',
      'codeBlock',
      'blockquote',
      'horizontalRule',
      'paragraph',
    ]);
    const s = JSON.stringify(d);
    for (const mark of ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'hardBreak'])
      expect(s, mark).toContain(`"${mark}"`);
    expect(s).toContain('"checked":true');
    expect(s).toContain('{\\"a\\":1}');
    expect(s).toContain('⚠');
  });

  it('свои теги Plane: упоминание — наш пользователь или @имя, картинка и вложение — подписи', () => {
    const html = (who: string) =>
      `<p>Привет <mention-component id="x" entity_identifier="${who}" entity_name="user_mention"></mention-component></p><image-component src="a" status="uploaded"></image-component><attachment-component name="v.mp4" src="b"></attachment-component>`;
    const uid = uuidv7();
    const known = htmlToDoc(html('p1'), () => ({ id: uid, label: 'alice' }))!;
    expect(JSON.stringify(known)).toContain(
      `"type":"mention","attrs":{"id":"${uid}","label":"alice"`,
    );
    expect(JSON.stringify(known)).toContain('[изображение]');
    expect(JSON.stringify(known)).toContain('[вложение: v.mp4]');
    expect(JSON.stringify(htmlToDoc(html('p2'), () => 'ghost'))).toContain('Привет @ghost');
    expect(JSON.stringify(htmlToDoc(html('p3'), none))).toContain('Привет @?');
  });

  it('пустое — null; скрипты и обработчики не выполняются', () => {
    expect(htmlToDoc('', none)).toBeNull();
    expect(htmlToDoc('<p class="editor-paragraph-block"></p>', none)).toBeNull();
    (globalThis as { __pwned?: boolean }).__pwned = false;
    const d = htmlToDoc(
      '<script>globalThis.__pwned = true</script><img src="x" onerror="globalThis.__pwned = true"><p>ok</p>',
      none,
    );
    expect((globalThis as { __pwned?: boolean }).__pwned).toBe(false);
    expect(JSON.stringify(d)).not.toContain('pwned');
  });
});

describe('импорт из API Plane', () => {
  it('предпросмотр: проекты, статусы, люди с e-mail; проект без доступа не мешает; не администратор — 403; ошибки Plane — 400', async () => {
    calls = [];
    const r = await post('/api/import/preview', adminCookie, conn());
    expect(r.statusCode, r.body).toBe(200);
    const pv = r.json();
    expect(pv.columns).toEqual([]);
    expect(pv.mapping.title).toBe('name');
    expect(pv.values).toEqual({
      status: ['Done', 'Todo'],
      project: [
        { name: 'Engineering', key: 'ENG' },
        { name: 'Secret', key: 'SEC' },
      ],
      people: ['alice.p', 'ghost'],
      emails: { 'alice.p': 'Alice@Example.com' },
    });
    // the preview reads no issues
    expect(calls.some((c) => c.includes('/issues/'))).toBe(false);
    expect((await post('/api/import/preview', memberCookie, conn())).statusCode).toBe(403);
    const badToken = await post('/api/import/preview', adminCookie, conn('wrong'));
    expect([badToken.statusCode, badToken.json().message]).toEqual([
      400,
      'Plane: неверный API-токен',
    ]);
    const noUrl = await post('/api/import/preview', adminCookie, { ...conn(), url: 'ftp://x' });
    expect(noUrl.statusCode).toBe(400);
    const wrongPreset = await post('/api/import/preview', adminCookie, {
      ...conn(),
      preset: 'jira',
    });
    expect(wrongPreset.statusCode).toBe(400);
  });

  it('задачи с HTML-описанием, комментарии по порядку от авторов с упоминанием, родитель; токен стирается; повтор обновляет без дублей', async () => {
    const pid = uuidv7();
    await w.admin.ok('project.create', {
      id: pid,
      spaceId: w.spaceId,
      name: 'Eng',
      key: key(),
      rank: 'a0',
    });
    const mapping = {
      projectMap: { Engineering: pid },
      statusNew: { Todo: 'todo', Done: 'done' },
      userMap: { ghost: w.member.userId },
    };
    const start = async () => {
      const r = await post('/api/import/jobs', adminCookie, {
        ...conn(),
        spaceId: w.spaceId,
        mapping: JSON.stringify(mapping),
      });
      expect(r.statusCode, r.body).toBe(202);
      const job = r.json().data;
      expect(job.source).toBeUndefined();
      const [row] = (
        await db.$client.query('select source, format from import_jobs where id = $1', [job.id])
      ).rows;
      expect(row.format).toBe('plane-api');
      expect(JSON.parse(row.source)).toMatchObject({ token: TOKEN, url: planeUrl, workspace: WS });
      rateLimited = true; // the first call of the job gets 429: waited out
      await worker.handler({ jobId: job.id }, jobApi);
      return (await db.$client.query('select * from import_jobs where id = $1', [job.id])).rows[0];
    };
    const job = await start();
    expect([job.status, job.error, job.total, job.created], JSON.stringify(job)).toEqual([
      'done',
      null,
      2, // the draft is not imported
      2,
    ]);
    expect(job.source).toBeNull();

    const tasks = (
      await db.$client.query(
        `select t.id, t.title, t.description, t.priority, t.due_date::text, t.parent_id, s.name as status
         from tasks t join statuses s on s.id = t.status_id where t.project_id = $1 order by t.title`,
        [pid],
      )
    ).rows;
    expect(tasks.map((t) => [t.title, t.status, t.priority])).toEqual([
      ['Задача 1', 'Todo', 2],
      ['Задача 2', 'Done', 0],
    ]);
    expect(tasks[0].due_date).toBe('2026-12-01');
    expect(tasks[1].parent_id).toBe(tasks[0].id);
    const desc = JSON.stringify(tasks[0].description);
    expect(desc).toContain('"type":"heading"');
    expect(desc).toContain('"type":"bold"');
    expect(desc).toContain('"type":"bulletList"');
    // assignee by the Plane e-mail (no table row), the label by its name
    const [a] = (
      await db.$client.query('select user_id from task_assignees where task_id = $1', [tasks[0].id])
    ).rows;
    expect(a.user_id).toBe(w.admin.userId);
    const labels = (
      await db.$client.query(
        'select l.name from task_labels tl join labels l on l.id = tl.label_id where tl.task_id = $1',
        [tasks[0].id],
      )
    ).rows;
    expect(labels).toEqual([{ name: 'bug' }]);

    const comments = (
      await db.$client.query(
        'select author_id, body from comments where task_id = $1 order by created_at, id',
        [tasks[0].id],
      )
    ).rows;
    expect(comments.map((c) => c.author_id)).toEqual([w.admin.userId, w.member.userId]);
    const first = JSON.stringify(comments[0].body);
    expect(first).toContain('2026-11-01 09:30');
    expect(first).toContain(`"type":"mention","attrs":{"id":"${w.admin.userId}"`);
    expect(JSON.stringify(comments[1].body)).toContain('второй');
    // the project without access was not chosen: not read at all
    expect(calls.some((c) => c.includes(P2) && c.includes('/issues/'))).toBe(false);

    const again = await start();
    expect([again.status, again.created, again.updated]).toEqual(['done', 0, 2]);
    const n = (
      await db.$client.query(
        'select count(*)::int as n from comments c join tasks t on t.id = c.task_id where t.project_id = $1',
        [pid],
      )
    ).rows[0].n;
    expect(n).toBe(2);
  });

  it('проект Plane без доступа — предупреждение, остальное импортируется; неверный токен при создании — 400, задание не создаётся', async () => {
    const pid = uuidv7();
    await w.admin.ok('project.create', {
      id: pid,
      spaceId: w.spaceId,
      name: 'Main',
      key: key(),
      rank: 'a0',
    });
    const before = (await db.$client.query('select count(*)::int as n from import_jobs')).rows[0].n;
    const bad = await post('/api/import/jobs', adminCookie, {
      ...conn('wrong'),
      projectId: pid,
      mapping: '{}',
    });
    expect(bad.statusCode).toBe(400);
    expect((await db.$client.query('select count(*)::int as n from import_jobs')).rows[0].n).toBe(
      before,
    );
    // a main project: every Plane project is read, the forbidden one is skipped with a warning
    const r = await post('/api/import/jobs', adminCookie, {
      ...conn(),
      projectId: pid,
      mapping: '{}',
    });
    expect(r.statusCode, r.body).toBe(202);
    await worker.handler({ jobId: r.json().data.id }, jobApi);
    const [job] = (
      await db.$client.query('select * from import_jobs where id = $1', [r.json().data.id])
    ).rows;
    expect(job.status, job.error).toBe('done');
    expect(job.warnings).toContainEqual({
      row: 0,
      message: expect.stringContaining('проект «Secret» пропущен'),
    });
    expect(
      (await post('/api/import/jobs', memberCookie, { ...conn(), projectId: pid, mapping: '{}' }))
        .statusCode,
    ).toBe(403);
  });

  it('PLNRAPP-877: недоверенный сертификат — предпросмотр отдаёт его; с его отпечатком импорт идёт, с чужим — отказ, токен не уходит', async () => {
    const tls = { ...conn(), url: planeTlsUrl };
    calls = [];
    const r = await post('/api/import/preview', adminCookie, tls);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().certificate).toEqual({
      subject: 'localhost',
      issuer: 'localhost',
      validTo: expect.stringMatching(/^2126-/),
      fingerprint256: CERT_FP,
    });
    expect(r.json().values.project).toEqual([]);
    // only the handshake: no request reached Plane
    expect(calls).toEqual([]);

    const ok = await post('/api/import/preview', adminCookie, {
      ...tls,
      fingerprint: CERT_FP.toLowerCase(),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().certificate).toBeUndefined();
    expect(ok.json().values.project).toHaveLength(2);

    calls = [];
    const wrong = await post('/api/import/preview', adminCookie, {
      ...tls,
      fingerprint: CERT_FP.replace(/^15/, '16'),
    });
    expect([wrong.statusCode, wrong.json().message]).toEqual([
      400,
      expect.stringContaining('сертификат https://127.0.0.1'),
    ]);
    expect(wrong.json().message).toContain('изменился');
    expect(calls).toEqual([]);
    const garbage = await post('/api/import/preview', adminCookie, { ...tls, fingerprint: 'xx' });
    expect(garbage.statusCode).toBe(400);

    // without the fingerprint the job is refused; with it — imported, the fingerprint goes away with the token
    const pid = uuidv7();
    await w.admin.ok('project.create', {
      id: pid,
      spaceId: w.spaceId,
      name: 'Tls',
      key: key(),
      rank: 'a0',
    });
    const job = (extra: Record<string, string>) =>
      post('/api/import/jobs', adminCookie, {
        ...tls,
        ...extra,
        spaceId: w.spaceId,
        mapping: JSON.stringify({ projectMap: { Engineering: pid } }),
      });
    const refused = await job({});
    expect([refused.statusCode, refused.json().message]).toEqual([
      400,
      expect.stringContaining('доверьте его по отпечатку'),
    ]);
    const started = await job({ fingerprint: CERT_FP });
    expect(started.statusCode, started.body).toBe(202);
    const id = started.json().data.id;
    expect(
      JSON.parse(
        (await db.$client.query('select source from import_jobs where id = $1', [id])).rows[0]
          .source,
      ),
    ).toMatchObject({ fingerprint: CERT_FP });
    await worker.handler({ jobId: id }, jobApi);
    const [done] = (await db.$client.query('select * from import_jobs where id = $1', [id])).rows;
    expect([done.status, done.error, done.created, done.source]).toEqual(['done', null, 2, null]);
  });
});
