import { request } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity, connect, type PeerCertificate, type TLSSocket } from 'node:tls';
import { z } from 'zod';
import type { PlaneCert, Preview } from '../shared/index.js';
import { ParseError, type Item } from './parse.js';

/** Plane connection of a plane-api job; kept in import_jobs.source only while the job runs. */
export const planeConnSchema = z.object({
  url: z
    .string()
    .trim()
    .regex(/^https?:\/\/[^/\s]+/i, 'адрес Plane: http(s)://…')
    .transform((u) => u.replace(/\/+$/, '')),
  workspace: z
    .string()
    .trim()
    .regex(/^[\w-]{1,100}$/, 'slug воркспейса Plane'),
  token: z.string().trim().min(1).max(500),
  /** SHA-256 of a certificate the user trusts (PLNRAPP-877): only it is accepted, instead of the CA check */
  fingerprint: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .trim()
      .regex(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/i, 'отпечаток сертификата: SHA-256')
      .transform((f) => f.toUpperCase())
      .optional(),
  ),
});
export type PlaneConn = z.infer<typeof planeConnSchema>;

/** Plane fields as mapping «columns»: the wizard only matches values, columns are fixed. */
export const PLANE_API_MAPPING = {
  externalId: 'identifier',
  title: 'name',
  description: 'description_html',
  status: 'state',
  assignee: 'assignees',
  labels: 'labels',
  dueDate: 'target_date',
  startDate: 'start_date',
  priority: 'priority',
  parent: 'parent',
  project: 'project',
  projectKey: 'project_identifier',
  comments: 'comments',
};

// as parsePriority: 1 = urgent … 4 = low, 0 = none
const PRIORITY: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4, none: 0 };

type Project = { id: string; name: string; identifier: string };
type Member = { id: string; display_name: string; email?: string | null };
type Issue = {
  id: string;
  sequence_id: number;
  name: string;
  description_html?: string | null;
  state?: { name: string } | null;
  assignees?: string[];
  labels?: string[];
  priority?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  parent?: string | null;
  is_draft?: boolean;
  archived_at?: string | null;
};
type Attachment = { id: string; attributes?: { name?: string; size?: number; type?: string } };
type Comment = { comment_html?: string | null; actor?: string | null; created_at: string };
type PageRef = { id: string; name?: string; parent?: string | null; archived_at?: string | null };

/** A Plane page of a project: HTML is converted by runImport with the people matched. */
export interface PlanePage {
  /** Plane project name: the page goes to the project of its issues */
  project: string;
  projectId: string;
  id: string;
  /** Plane id of the parent page; null — a root page */
  parent: string | null;
  name: string;
  html: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plane's certificate is not trusted by the server: the wizard shows it to be trusted by its fingerprint. */
export class PlaneUntrusted extends ParseError {
  constructor(
    url: string,
    readonly certificate: PlaneCert,
  ) {
    super(
      `Plane: сертификат ${url} не доверен серверу Planar — доверьте его по отпечатку в мастере импорта или добавьте корневой сертификат в NODE_EXTRA_CA_CERTS`,
    );
  }
}

const certOf = (c: PeerCertificate): PlaneCert => ({
  subject: String(c.subject?.CN ?? ''),
  issuer: String(c.issuer?.CN ?? ''),
  validTo: new Date(c.valid_to).toISOString(),
  fingerprint256: c.fingerprint256,
});

const tlsOpts = (u: URL) => ({
  host: u.hostname,
  port: Number(u.port || 443),
  servername: isIP(u.hostname) ? undefined : u.hostname,
  rejectUnauthorized: false,
  timeout: 60_000,
});
const unreachable = (e: Error) =>
  new ParseError(`Plane недоступен: ${(e as NodeJS.ErrnoException).code ?? e.message}`);

/** TLS handshake without verification only to read the certificate; nothing is sent. */
function peerCert(u: URL): Promise<PlaneCert> {
  return new Promise((ok, fail) => {
    const s = connect(tlsOpts(u), () => {
      ok(certOf(s.getPeerCertificate()));
      s.destroy();
    });
    s.once('error', (e) => fail(unreachable(e)));
    s.once('timeout', () => s.destroy(new Error('таймаут')));
  });
}

/**
 * A TLS connection accepted only with the trusted certificate and the host name in it — checked before any byte
 * (the token) is sent; tls options cannot do this: Node checks the host name only after a valid chain.
 */
function pinnedSocket(u: URL, fp: string): Promise<TLSSocket> {
  return new Promise((ok, fail) => {
    const s = connect(tlsOpts(u), () => {
      const cert = s.getPeerCertificate();
      if (cert.fingerprint256 !== fp) {
        s.destroy();
        return fail(
          new ParseError(
            `Plane: сертификат ${u.origin} изменился (отпечаток ${cert.fingerprint256}) — подтвердите его заново`,
          ),
        );
      }
      const err = checkServerIdentity(u.hostname, cert);
      if (!err) return ok(s);
      s.destroy();
      fail(new ParseError(`Plane: ${err.message}`));
    });
    s.once('error', (e) => fail(unreachable(e)));
    s.once('timeout', () => s.destroy(new Error('таймаут')));
  });
}

type Res = { status: number; header(name: string): string | null; json(): Promise<unknown> };

/** GET over the pinned connection (no agent: a new verified connection per request). */
async function pinnedGet(url: string, headers: Record<string, string>, fp: string): Promise<Res> {
  const u = new URL(url);
  const socket = await pinnedSocket(u, fp);
  return new Promise((ok, fail) => {
    const req = request(u, { headers, createConnection: () => socket, timeout: 60_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', (e) => fail(unreachable(e)));
      res.on('end', () =>
        ok({
          status: res.statusCode ?? 0,
          header: (n) => (res.headers[n] === undefined ? null : String(res.headers[n])),
          json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        }),
      );
    });
    req.on('error', (e) => fail(unreachable(e)));
    req.on('timeout', () => req.destroy(new Error('таймаут')));
    req.end();
  });
}

async function plainGet(url: string, headers: Record<string, string>): Promise<Res> {
  try {
    const res = await fetch(url, {
      headers,
      // a redirect is a status: a file answers 302 to a signed link, the API otherwise — an error
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    return { status: res.status, header: (n) => res.headers.get(n), json: () => res.json() };
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code ?? '';
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(code)) {
      const u = new URL(url);
      throw new PlaneUntrusted(u.origin, await peerCert(u));
    }
    throw new ParseError(`Plane недоступен: ${code || (e as Error).message}`);
  }
}

/** A response body up to maxBytes (Content-Length is checked first, then the bytes read). */
async function readCapped(
  body: AsyncIterable<Uint8Array>,
  length: string | null,
  maxBytes: number,
): Promise<Buffer> {
  const tooBig = () => new ParseError(`больше ${Math.round(maxBytes / 1048576)} МБ`);
  if (Number(length ?? 0) > maxBytes) throw tooBig();
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maxBytes) throw tooBig();
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

/** GET of a file over the pinned connection, capped at maxBytes. */
async function pinnedFile(
  url: string,
  fp: string,
  maxBytes: number,
): Promise<{ status: number; buf: Buffer; mime: string }> {
  const u = new URL(url);
  const socket = await pinnedSocket(u, fp);
  return new Promise((ok, fail) => {
    const req = request(u, { createConnection: () => socket, timeout: 120_000 }, (res) => {
      const status = res.statusCode ?? 0;
      const mime = String(res.headers['content-type'] ?? '').split(';')[0]!;
      if (status !== 200) {
        res.destroy();
        return ok({ status, buf: Buffer.alloc(0), mime });
      }
      readCapped(res, res.headers['content-length'] ?? null, maxBytes).then(
        (buf) => ok({ status, buf, mime }),
        (e: Error) => {
          res.destroy();
          fail(e);
        },
      );
    });
    req.on('error', (e) => fail(unreachable(e)));
    req.on('timeout', () => req.destroy(new Error('таймаут')));
    req.end();
  });
}

/** Plane API v1 client: X-API-Key, cursor pages, waits out the rate limit; errors — in plain words. */
export function planeClient(c: PlaneConn) {
  const base = `${c.url}/api/v1/workspaces/${c.workspace}`;
  /** redirect — a 3xx is returned, not an error (a file: 302 to a signed link) */
  async function send(path: string, redirect = false): Promise<Res> {
    for (let attempt = 0; ; attempt++) {
      const headers = { 'X-API-Key': c.token, Accept: 'application/json' };
      // a trusted fingerprint applies to https only: plain http has no certificate
      const res =
        c.fingerprint && c.url.startsWith('https:')
          ? await pinnedGet(base + path, headers, c.fingerprint)
          : await plainGet(base + path, headers);
      if (res.status === 429 && attempt < 5) {
        // X-RateLimit-Reset — epoch seconds; Retry-After — seconds
        const reset = Number(res.header('x-ratelimit-reset')) * 1000 - Date.now();
        const after = Number(res.header('retry-after')) * 1000;
        await wait(Math.min(Math.max(reset || after || 1000, 1000), 120_000));
        continue;
      }
      if (res.status === 401) throw new ParseError('Plane: неверный API-токен');
      if (res.status === 403) throw new PlaneForbidden(path);
      if (res.status === 404) throw new ParseError(`Plane: не найдено (${path.split('?')[0]})`);
      if (res.status < 200 || res.status >= (redirect ? 400 : 300))
        throw new ParseError(`Plane: ошибка ${res.status} (${path.split('?')[0]})`);
      // little quota left: slow down instead of hitting 429
      if (Number(res.header('x-ratelimit-remaining') ?? 100) < 5) await wait(1000);
      return res;
    }
  }
  const get = async <T>(path: string): Promise<T> => (await send(path)).json() as Promise<T>;
  /**
   * A file: Plane answers 302 to a signed storage link, fetched without the API key, capped at maxBytes.
   * The link to Plane's own host goes over the trusted certificate too.
   */
  async function file(path: string, maxBytes: number): Promise<{ buf: Buffer; mime: string }> {
    const loc = (await send(path, true)).header('location');
    if (!loc) throw new ParseError('Plane: нет ссылки на файл');
    const u = new URL(loc, c.url);
    let r: { status: number; buf: Buffer; mime: string };
    if (c.fingerprint && u.protocol === 'https:' && u.origin === new URL(c.url).origin)
      r = await pinnedFile(u.href, c.fingerprint, maxBytes);
    else {
      const res = await fetch(u, { signal: AbortSignal.timeout(120_000) });
      r = {
        status: res.status,
        mime: res.headers.get('content-type')?.split(';')[0] ?? '',
        buf:
          res.ok && res.body
            ? await readCapped(res.body, res.headers.get('content-length'), maxBytes)
            : Buffer.alloc(0),
      };
      if (!res.ok) await res.body?.cancel();
    }
    if (r.status !== 200) throw new ParseError(`хранилище Plane ответило ${r.status}`);
    return r;
  }
  /** every page of a list: `results` + next_cursor (an empty cursor is rejected — the first page has none) */
  async function all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    let cursor: string | null = null;
    for (;;) {
      const page: T[] | { results: T[]; next_cursor?: string; next_page_results?: boolean } =
        await get(`${path}${sep}per_page=100${cursor ? `&cursor=${cursor}` : ''}`);
      if (Array.isArray(page)) return page;
      out.push(...page.results);
      if (!page.next_page_results || !page.next_cursor) return out;
      cursor = page.next_cursor;
    }
  }
  return { get, all, file };
}

/**
 * An issue id for files that belong to no issue (page images): Plane's issue-attachments endpoint looks the
 * asset up by workspace and project only — checked on Plane 2026-11 (an asset of another project — 404).
 */
export const PLANE_ANY_ISSUE = '00000000-0000-4000-8000-000000000000';

/** No access to a Plane object (a project the token's user is not in): skipped with a warning. */
export class PlaneForbidden extends Error {
  constructor(path: string) {
    super(`Plane: нет доступа (${path.split('?')[0]})`);
  }
}

/** Projects, statuses and people for the wizard: no issues are read. An untrusted certificate — returned to be trusted. */
export async function planePreview(c: PlaneConn): Promise<Preview> {
  try {
    return await readPreview(c);
  } catch (e) {
    if (!(e instanceof PlaneUntrusted)) throw e;
    return {
      columns: [],
      rows: [],
      mapping: PLANE_API_MAPPING,
      values: { status: [], project: [], people: [] },
      certificate: e.certificate,
    };
  }
}

async function readPreview(c: PlaneConn): Promise<Preview> {
  const api = planeClient(c);
  const [projects, members] = await Promise.all([
    api.all<Project>('/projects/'),
    api.all<Member>('/members/'),
  ]);
  const status = new Set<string>();
  for (const p of projects)
    try {
      for (const s of await api.all<{ name: string }>(`/projects/${p.id}/states/`))
        status.add(s.name);
    } catch (e) {
      if (!(e instanceof PlaneForbidden)) throw e;
    }
  return {
    columns: [],
    rows: [],
    mapping: PLANE_API_MAPPING,
    values: {
      status: [...status].sort(),
      project: projects.map((p) => ({ name: p.name, key: p.identifier })),
      people: members.map((m) => m.display_name).sort(),
      emails: Object.fromEntries(
        members.filter((m) => m.email).map((m) => [m.display_name, m.email!]),
      ),
    },
  };
}

export interface PlaneData {
  items: Item[];
  /** Plane user id → display name (a mention, a comment author) */
  people: Map<string, string>;
  /** display name → e-mail: matching people by e-mail without the wizard's table */
  emails: Map<string, string>;
  warnings: { row: number; message: string }[];
  pages: PlanePage[];
  /** a file of an issue: its attachment or an image of its text (the same Plane endpoint) */
  file(
    project: string,
    issue: string,
    asset: string,
    maxBytes: number,
  ): Promise<{ buf: Buffer; mime: string }>;
}

/**
 * Pages of a project: the root list, then ?parent= of each page (breadth-first, archived ones skipped).
 * seen — the same page from several lists is taken once; a list without `parent` gives the queried parent.
 */
async function projectPages(api: ReturnType<typeof planeClient>, project: string) {
  const out: (PageRef & { parent: string | null })[] = [];
  const seen = new Set<string>();
  const queue: (string | null)[] = [null];
  while (queue.length) {
    const parent = queue.shift()!;
    const list = await api.all<PageRef>(
      `/projects/${project}/pages/${parent ? `?parent=${parent}` : ''}`,
    );
    for (const pg of list)
      if (!seen.has(pg.id) && !pg.archived_at) {
        seen.add(pg.id);
        out.push({ ...pg, parent: pg.parent ?? parent });
        queue.push(pg.id);
      }
  }
  return out;
}

/**
 * Issues of the chosen projects (by name; null — all) with comments, as import rows, and their pages.
 * Descriptions, comments and pages stay HTML: runImport converts them with the people matched.
 * docsOn(project name) — whether its target project has «Документы» on: otherwise pages are only counted.
 * onProgress — after each page/issue batch: keeps the job alive for the sweep.
 */
export async function planeItems(
  c: PlaneConn,
  projectNames: Set<string> | null,
  onProgress: () => Promise<unknown>,
  docsOn: (project: string) => boolean = () => false,
): Promise<PlaneData> {
  const api = planeClient(c);
  const members = await api.all<Member>('/members/');
  const people = new Map(members.map((m) => [m.id, m.display_name]));
  const emails = new Map(members.filter((m) => m.email).map((m) => [m.display_name, m.email!]));
  const items: Item[] = [];
  const warnings: PlaneData['warnings'] = [];
  const pages: PlanePage[] = [];
  for (const p of await api.all<Project>('/projects/')) {
    if (projectNames && !projectNames.has(p.name)) continue;
    try {
      const labels = new Map(
        (await api.all<{ id: string; name: string }>(`/projects/${p.id}/labels/`)).map((l) => [
          l.id,
          l.name,
        ]),
      );
      const issues = (await api.all<Issue>(`/projects/${p.id}/issues/?expand=state`)).filter(
        (i) => !i.is_draft && !i.archived_at,
      );
      await onProgress();
      const key = new Map(issues.map((i) => [i.id, `${p.identifier}-${i.sequence_id}`]));
      for (const [n, i] of issues.entries()) {
        const path = `/projects/${p.id}/issues/${i.id}`;
        const comments = await api.all<Comment>(`${path}/comments/`);
        const files = await api.all<Attachment>(`${path}/issue-attachments/`);
        const it: Item = {
          row: items.length + 1,
          externalId: key.get(i.id),
          title: i.name.trim() || key.get(i.id)!,
          description: null,
          descriptionHtml: i.description_html ?? '',
          status: i.state?.name,
          assignees: (i.assignees ?? []).flatMap((a) => people.get(a) ?? []),
          labels: (i.labels ?? []).flatMap((l) => labels.get(l) ?? []),
          dueDate: i.target_date ?? null,
          startDate: i.start_date ?? null,
          priority: PRIORITY[i.priority ?? 'none'] ?? 0,
          project: p.name,
          projectKey: p.identifier,
          comments: comments
            .filter((x) => x.comment_html)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((x) => ({
              text: '',
              html: x.comment_html!,
              author: (x.actor && people.get(x.actor)) || '',
              at: x.created_at.slice(0, 16).replace('T', ' '),
            })),
          notes: [],
          plane: {
            project: p.id,
            issue: i.id,
            attachments: files.map((f) => ({
              id: f.id,
              name: f.attributes?.name || f.id,
              mime: f.attributes?.type ?? '',
            })),
          },
        };
        // a parent of another project / archived — not in this list
        if (i.parent) it.parentExt = key.get(i.parent) ?? i.parent;
        items.push(it);
        if (n % 100 === 99) await onProgress();
      }
    } catch (e) {
      if (!(e instanceof PlaneForbidden)) throw e;
      warnings.push({ row: 0, message: `проект «${p.name}» пропущен: ${e.message}` });
      continue;
    }
    // pages are not issues: an error of theirs (an older Plane without the pages API included) — a warning
    try {
      const refs = await projectPages(api, p.id);
      if (refs.length && !docsOn(p.name)) {
        warnings.push({
          row: 0,
          message: `страницы проекта «${p.name}» (${refs.length}) не импортированы: модуль «Документы» выключен в проекте`,
        });
        continue;
      }
      for (const r of refs)
        try {
          const d = await api.get<{ name?: string; description_html?: string | null }>(
            `/projects/${p.id}/pages/${r.id}/`,
          );
          pages.push({
            project: p.name,
            projectId: p.id,
            id: r.id,
            parent: r.parent,
            name: (d.name ?? r.name ?? '').trim(),
            html: d.description_html ?? '',
          });
        } catch (e) {
          // a private page of another user
          if (!(e instanceof PlaneForbidden)) throw e;
          warnings.push({
            row: 0,
            message: `страница «${r.name ?? r.id}» пропущена: ${e.message}`,
          });
        }
      await onProgress();
    } catch (e) {
      if (!(e instanceof ParseError || e instanceof PlaneForbidden)) throw e;
      warnings.push({ row: 0, message: `страницы проекта «${p.name}» не прочитаны: ${e.message}` });
    }
  }
  return {
    items,
    people,
    emails,
    warnings,
    pages,
    file: (project, issue, asset, maxBytes) =>
      api.file(`/projects/${project}/issues/${issue}/issue-attachments/${asset}/`, maxBytes),
  };
}
