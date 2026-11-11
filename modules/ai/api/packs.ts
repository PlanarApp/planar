import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { crc32, inflateRawSync } from 'node:zlib';
import { eq, sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import { stringify as stringifyYaml } from 'yaml';
import { docToMarkdown, markdownToDoc } from '@planar/editor/markdown';
import type { CoreServices } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  instructionSchema,
  parseHarnessYaml,
  parseInstructionDoc,
  type Harness,
  type Instruction,
} from '../shared/index.js';
import { aiHarnessPacks as P } from './schema.js';

/**
 * Harness packs (PLNRAPP-169): a pack on disk / in a zip is `harness.yml` + `actions/<key>.md`. In a project it is
 * documents: «Harness-пакеты» → [pack] (the harness.yml code block) → [instruction] pages
 * (1st paragraph — description, table of parameters, then the prompt).
 */

export const PACKS_ROOT_TITLE = 'Harness-пакеты';
const CATALOG_TITLES: Record<string, string> = { dev: 'Разработка' };
const KEY_RE = /^[a-z][a-z0-9_-]{0,49}$/;
const YML = 'harness.yml';
const MAX_ENTRIES = 100;
const MAX_UNPACKED = 4 * 1024 * 1024;

export type PackFiles = Record<string, string>;
export interface ParsedPack {
  /** canonical text of harness.yml */
  yml: string;
  harness: Harness;
  actions: Record<string, Instruction>;
}
type Node = { type?: string; text?: string; content?: Node[]; attrs?: Record<string, unknown> };
type Doc = { type: 'doc'; content: Node[] };

// ---------- catalog and zip ----------

async function catalogDir(): Promise<string | null> {
  // source: api/ → ../harnesses; built: dist/api/ → ../../harnesses
  for (const rel of ['../harnesses', '../../harnesses']) {
    const dir = new URL(rel + '/', import.meta.url);
    if (
      await readdir(dir).then(
        () => true,
        () => false,
      )
    )
      return dir.pathname;
  }
  return null;
}

export async function readCatalogPack(key: string): Promise<PackFiles | null> {
  const root = await catalogDir();
  if (!root || !KEY_RE.test(key)) return null;
  const dir = `${root}${key}/`;
  const files: PackFiles = {};
  try {
    files[YML] = await readFile(dir + YML, 'utf8');
    for (const f of await readdir(dir + 'actions'))
      if (f.endsWith('.md')) files[`actions/${f}`] = await readFile(`${dir}actions/${f}`, 'utf8');
  } catch {
    return null;
  }
  return files;
}

export async function listCatalog() {
  const root = await catalogDir();
  if (!root) return [];
  const out: { key: string; title: string; actions: number }[] = [];
  for (const d of (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory())) {
    const files = await readCatalogPack(d.name);
    if (!files) continue;
    out.push({
      key: d.name,
      title: CATALOG_TITLES[d.name] ?? d.name,
      actions: Object.keys(files).filter((p) => p.startsWith('actions/')).length,
    });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

export const catalogTitle = (key: string) => CATALOG_TITLES[key] ?? key;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

/** zip without compression (method 0): packs are a few KB of text. */
export function zipFiles(files: PackFiles): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(text);
    const common = Buffer.concat([
      u16(20), // version needed
      u16(0x0800), // utf-8 names
      u16(0), // stored
      u16(0),
      u16(0x21), // time 00:00:00, date 1980-01-01
      u32(crc32(data)),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
    ]);
    const head = Buffer.concat([u32(0x04034b50), common, name]);
    local.push(head, data);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        common,
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(off),
        name,
      ]),
    );
    off += head.length + data.length;
  }
  const cd = Buffer.concat(central);
  const n = Object.keys(files).length;
  return Buffer.concat([
    ...local,
    cd,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(n),
    u16(n),
    u32(cd.length),
    u32(off),
    u16(0),
  ]);
}

/** Text files of a zip (stored or deflate); a single top-level folder is stripped. Anything unsafe or too big throws. */
export function unzipFiles(buf: Buffer): PackFiles {
  const bad = (m: string) => new Error(`zip: ${m}`);
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw bad('не zip-архив');
  const n = buf.readUInt16LE(e + 10);
  if (n > MAX_ENTRIES) throw bad('слишком много файлов');
  let p = buf.readUInt32LE(e + 16);
  const raw: PackFiles = {};
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad('повреждён');
    const h = p;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extra;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw bad('зашифрованный архив');
    if (name.startsWith('/') || name.split('/').includes('..')) throw bad(`путь ${name}`);
    if (size > MAX_UNPACKED || (total += size) > MAX_UNPACKED) throw bad('слишком большой');
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw bad('повреждён');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const csize = buf.readUInt32LE(h + 20);
    const data = buf.subarray(start, start + csize);
    if (method === 0) raw[name] = data.toString('utf8');
    else if (method === 8)
      raw[name] = inflateRawSync(data, { maxOutputLength: MAX_UNPACKED }).toString('utf8');
    else throw bad(`метод сжатия ${method}`);
  }
  const names = Object.keys(raw).filter((x) => !x.startsWith('__MACOSX/'));
  const tops = new Set(names.map((x) => x.split('/')[0]));
  const strip = !names.includes(YML) && tops.size === 1 ? `${[...tops][0]}/` : '';
  return Object.fromEntries(
    names.filter((x) => x.startsWith(strip)).map((x) => [x.slice(strip.length), raw[x]!]),
  );
}

// ---------- canonical forms ----------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ymlText = (t: string) => `${t.trim()}\n`;
const mdOf = (nodes: Node[]) => docToMarkdown({ type: 'doc', content: nodes } as never).trim();
const normPrompt = (p: string) => mdOf((markdownToDoc(p) as Doc).content);

/** Instruction in the one text form the hashes, the merge and the export use. */
export function instructionText(i: Instruction): string {
  const fm = stringifyYaml({
    name: i.name,
    ...(i.description ? { description: i.description } : {}),
    runtime: i.runtime,
    ...(i.model ? { model: i.model } : {}),
    ...(i.checks.length ? { checks: i.checks } : {}),
  });
  return `---\n${fm}---\n\n${i.prompt}\n`;
}

/** Validates a pack: harness.yml, every `actions` entry has its file, all instructions parse. */
export function parsePack(files: PackFiles): ParsedPack {
  if (files[YML] === undefined) throw new Error('в пакете нет harness.yml');
  const harness = parseHarnessYaml(files[YML]);
  const actions: Record<string, Instruction> = {};
  for (const k of harness.actions) {
    const text = files[`actions/${k}.md`];
    if (text === undefined) throw new Error(`в пакете нет actions/${k}.md`);
    const i = parseInstructionDoc(text);
    actions[k] = { ...i, prompt: normPrompt(i.prompt) };
  }
  return { yml: ymlText(files[YML]), harness, actions };
}

// ---------- pages ----------

const para = (t: string): Node => ({
  type: 'paragraph',
  content: t ? [{ type: 'text', text: t }] : [],
});
const row = (cells: string[], head = false): Node => ({
  type: 'tableRow',
  content: cells.map((c) => ({ type: head ? 'tableHeader' : 'tableCell', content: [para(c)] })),
});
const flat = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

export function instructionBody(key: string, i: Instruction): Doc {
  const rows = [
    ['key', key],
    ['runtime', i.runtime],
    ...(i.model ? [['model', i.model]] : []),
    ...i.checks.map((c) => ['checks', flat(c)]),
  ];
  return {
    type: 'doc',
    content: [
      ...(i.description ? [para(flat(i.description))] : []),
      { type: 'table', content: [row(['Параметр', 'Значение'], true), ...rows.map((r) => row(r))] },
      ...(markdownToDoc(i.prompt) as Doc).content,
    ],
  };
}
export const ymlBody = (yml: string): Doc => ({
  type: 'doc',
  content: [
    {
      type: 'codeBlock',
      attrs: { language: 'yaml' },
      content: [{ type: 'text', text: yml.trim() }],
    },
  ],
});

const textOf = (n: Node): string => n.text ?? (n.content ?? []).map(textOf).join('');

/** The page back to {key, instruction}; null — the page is not an instruction (the structure is broken). */
export function readInstructionPage(
  title: string,
  body: Doc,
): { key: string; i: Instruction } | null {
  const nodes = body.content ?? [];
  const d = nodes[0]?.type === 'paragraph' ? textOf(nodes[0]).trim() : undefined;
  const table = nodes[d === undefined ? 0 : 1];
  if (table?.type !== 'table') return null;
  const params: Record<string, string[]> = {};
  for (const r of (table.content ?? []).slice(1)) {
    const [k, v] = (r.content ?? []).map((c) => textOf(c).trim());
    if (k) (params[k] ??= []).push(v ?? '');
  }
  const key = params.key?.[0];
  const r = instructionSchema.safeParse({
    name: title,
    description: d || undefined,
    runtime: params.runtime?.[0] || undefined,
    model: params.model?.[0] || undefined,
    checks: params.checks?.filter(Boolean),
  });
  if (!key || !KEY_RE.test(key) || !r.success) return null;
  return {
    key,
    i: { ...r.data, prompt: mdOf(nodes.slice(d === undefined ? 1 : 2)) },
  };
}
export const readYmlPage = (body: Doc): string | null => {
  const c = (body.content ?? []).find((n) => n.type === 'codeBlock');
  return c ? ymlText(textOf(c)) : null;
};

export interface PackPage {
  /** `harness.yml` or the action key */
  key: string;
  title: string;
  body: Doc;
  /** canonical text of the page and its sha256 */
  file: string;
  hash: string;
}
export function packPages(p: ParsedPack, title: string): PackPage[] {
  return [
    { key: YML, title, body: ymlBody(p.yml), file: p.yml, hash: sha(p.yml) },
    ...Object.entries(p.actions).map(([key, i]) => {
      const file = instructionText(i);
      return { key, title: i.name, body: instructionBody(key, i), file, hash: sha(file) };
    }),
  ];
}
/** `text` of docs_pages for a body: text nodes joined by a space (same as the docs mutators). */
export function plainText(body: Doc): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.type === 'text' && typeof n.text === 'string') out.push(n.text);
    n.content?.forEach(walk);
  };
  walk(body);
  return out.join(' ').slice(0, 100_000);
}

// ---------- the project side ----------

export class PackError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
type Db = CoreServices['db'];
interface PageRow {
  id: string;
  title: string;
  body: Doc;
}
export type Resolve = 'reset' | 'keep' | { merged: string };
export interface Conflict {
  key: string;
  pageId: string;
  title: string;
}

const rows = async <T>(db: Db, s: ReturnType<typeof sql>) => (await db.execute(s)).rows as T[];
const pageRows = (db: Db, parentId: string) =>
  rows<PageRow>(
    db,
    sql`select id, title, body from docs_pages where parent_id = ${parentId}::uuid and archived_at is null`,
  );
const alive = async (db: Db, id: string | null) =>
  !!id &&
  (await rows(db, sql`select 1 from docs_pages where id = ${id}::uuid and archived_at is null`))
    .length > 0;

async function lastRank(db: Db, projectId: string, parentId: string | null) {
  const r = await rows<{ r: string | null }>(
    db,
    parentId
      ? sql`select max(rank collate "C") as r from docs_pages where parent_id = ${parentId}::uuid`
      : sql`select max(rank collate "C") as r from docs_pages where project_id = ${projectId}::uuid and parent_id is null`,
  );
  return r[0]?.r ?? null;
}

/** Pack row of the project; the active one with a dead root (documents deleted or archived) is reset here. */
export async function checkAlive(
  db: Db,
  core: Pick<CoreServices, 'execute' | 'systemUserId'>,
  projectId: string,
) {
  const packs = await db.select().from(P).where(eq(P.projectId, projectId));
  const warnings: string[] = [];
  for (const p of packs) {
    if (!p.active || (await alive(db, p.rootPageId))) continue;
    await db
      .update(P)
      .set({ active: false, updatedAt: sql`now()` })
      .where(eq(P.id, p.id));
    p.active = false;
    warnings.push(
      `Документы пакета «${p.packKey}» удалены: пакет больше не активен, правила отключены`,
    );
    const rules = await rows<{ id: string }>(
      db,
      sql`select r.id from ai_harness_keys k join automations_rules r on r.id = k.entity_id
          where k.project_id = ${projectId}::uuid and k.kind = 'rule' and r.enabled`,
    );
    if (rules.length)
      await core.execute(
        core.systemUserId(),
        rules.map((r) => ({ name: 'automations.update', args: { id: r.id, enabled: false } })),
        { system: true },
      );
  }
  return { packs, warnings };
}

export async function listProjectPacks(db: Db, core: CoreServices, projectId: string) {
  const { packs, warnings } = await checkAlive(db, core, projectId);
  const out = [];
  for (const p of packs) {
    const root = p.rootPageId
      ? (
          await rows<{ title: string }>(
            db,
            sql`select title from docs_pages where id = ${p.rootPageId}::uuid and archived_at is null`,
          )
        )[0]
      : undefined;
    out.push({
      packKey: p.packKey,
      title: root?.title ?? null,
      active: p.active,
      rootPageId: root ? p.rootPageId : null,
    });
  }
  return { packs: out, warnings };
}

export async function activate(db: Db, core: CoreServices, projectId: string, packKey: string) {
  const { packs, warnings } = await checkAlive(db, core, projectId);
  const p = packs.find((x) => x.packKey === packKey);
  if (!p) throw new PackError(404, 'Пакет не загружен в проект');
  if (!(await alive(db, p.rootPageId)))
    throw new PackError(409, 'Документы пакета удалены или в архиве: загрузите пакет заново');
  await db.transaction(async (tx) => {
    await tx.update(P).set({ active: false }).where(eq(P.projectId, projectId));
    await tx
      .update(P)
      .set({ active: true, updatedAt: sql`now()` })
      .where(eq(P.id, p.id));
  });
  return { packKey, active: true, warnings };
}

/** The pages of a loaded pack by pack key, as they are now. */
async function currentPages(db: Db, rootPageId: string) {
  const map = new Map<string, { id: string; title: string; file: string; hash: string }>();
  const root = (
    await rows<PageRow>(
      db,
      sql`select id, title, body from docs_pages where id = ${rootPageId}::uuid`,
    )
  )[0];
  const yml = root && readYmlPage(root.body);
  if (root && yml !== null)
    map.set(YML, { id: root.id, title: root.title, file: yml!, hash: sha(yml!) });
  for (const c of await pageRows(db, rootPageId)) {
    const r = readInstructionPage(c.title, c.body);
    if (!r || map.has(r.key)) continue;
    const file = instructionText(r.i);
    map.set(r.key, { id: c.id, title: c.title, file, hash: sha(file) });
  }
  return map;
}

export interface UploadOpts {
  projectId: string;
  packKey: string;
  files: PackFiles;
  title?: string;
  resolve?: Record<string, Resolve>;
}

/** What the new pack does against the loaded one: pages the user changed that the pack changes too. */
async function plan(db: Db, o: UploadOpts) {
  const pack = parsePack(o.files);
  const [loaded] = await db
    .select()
    .from(P)
    .where(sql`${P.projectId} = ${o.projectId}::uuid and ${P.packKey} = ${o.packKey}`);
  const live = loaded && (await alive(db, loaded.rootPageId)) ? loaded : undefined;
  const cur = live ? await currentPages(db, live.rootPageId!) : new Map();
  const pages = packPages(pack, o.title ?? catalogTitle(o.packKey));
  const conflicts: Conflict[] = [];
  for (const pg of pages) {
    const c = cur.get(pg.key);
    const was = c && live!.hashes[c.id];
    // the user changed the page, and the pack differs from both what they loaded and what they have
    if (c && c.hash !== was && pg.hash !== was && pg.hash !== c.hash)
      conflicts.push({ key: pg.key, pageId: c.id, title: c.title });
  }
  return { pack, live, loaded, cur, pages, conflicts };
}

export async function conflictsOf(db: Db, o: UploadOpts) {
  const p = await plan(db, o);
  return { conflicts: p.conflicts, incoming: p.pages, current: p.cur };
}

/** Merged text of a conflicting page → a checked page body (the instruction or harness.yml). */
function mergedPage(key: string, text: string): { body: Doc; title?: string; file: string } {
  if (key === YML) {
    parseHarnessYaml(text);
    return { body: ymlBody(ymlText(text)), file: ymlText(text) };
  }
  const i = parseInstructionDoc(text);
  const n = { ...i, prompt: normPrompt(i.prompt) };
  return { body: instructionBody(key, n), title: n.name, file: instructionText(n) };
}

export async function upload(db: Db, core: CoreServices, userId: string, o: UploadOpts) {
  const [project] = await rows<{ spaceId: string }>(
    db,
    sql`select space_id as "spaceId" from projects where id = ${o.projectId}::uuid`,
  );
  if (!project) throw new PackError(404, 'Проект не найден');
  let p;
  try {
    p = await plan(db, o);
  } catch (e) {
    throw new PackError(400, (e as Error).message);
  }
  const missing = p.conflicts.filter((c) => !o.resolve?.[c.key]);
  if (missing.length) return { status: 'conflict' as const, conflicts: p.conflicts };

  const muts: { name: string; args: unknown }[] = [];
  const hashes: Record<string, string> = {};
  const result = { created: [] as string[], updated: [] as string[], kept: [] as string[] };
  const { spaceId } = project;
  const projectId = o.projectId;
  const create = (id: string, parentId: string | null, rank: string, title: string, body: Doc) =>
    muts.push({
      name: 'docs.page.create',
      args: { id, spaceId, ...(parentId ? {} : { projectId }), parentId, rank, title, body },
    });

  let rootId = p.live?.rootPageId ?? null;
  const fresh = !rootId;
  if (!rootId) {
    let container = (
      await rows<{ id: string }>(
        db,
        sql`select id from docs_pages where project_id = ${projectId}::uuid and parent_id is null
            and title = ${PACKS_ROOT_TITLE} and archived_at is null limit 1`,
      )
    )[0]?.id;
    if (!container) {
      container = uuidv7();
      const [rank] = generateNKeysBetween(await lastRank(db, projectId, null), null, 1);
      create(container, null, rank!, PACKS_ROOT_TITLE, { type: 'doc', content: [] });
    }
    rootId = uuidv7();
    const [rank] = generateNKeysBetween(await lastRank(db, projectId, container), null, 1);
    const root = p.pages[0]!;
    create(rootId, container, rank!, root.title, root.body);
    hashes[rootId] = root.hash;
    result.created.push(YML);
  }
  const newPages = p.pages.filter((pg) => (fresh ? pg.key !== YML : !p.cur.get(pg.key)));
  const ranks = generateNKeysBetween(
    fresh ? null : await lastRank(db, projectId, rootId),
    null,
    newPages.length,
  );
  newPages.forEach((pg, n) => {
    const id = uuidv7();
    create(id, rootId, ranks[n]!, pg.title, pg.body);
    hashes[id] = pg.hash;
    result.created.push(pg.key);
  });

  if (!fresh)
    for (const pg of p.pages) {
      const c = p.cur.get(pg.key);
      if (!c) continue;
      const was = p.live!.hashes[c.id];
      const r = p.conflicts.some((x) => x.key === pg.key) ? o.resolve![pg.key]! : undefined;
      const write = (title: string | undefined, body: Doc, hash: string, key: string) => {
        muts.push({
          name: 'docs.page.update',
          args: { id: c.id, ...(key !== YML && title ? { title } : {}), body },
        });
        hashes[c.id] = hash;
        result.updated.push(key);
      };
      if (r === 'keep') {
        hashes[c.id] = pg.hash; // asked once: the next upload of the same pack does not ask again
        result.kept.push(pg.key);
      } else if (typeof r === 'object') {
        let m;
        try {
          m = mergedPage(pg.key, r.merged);
        } catch (e) {
          throw new PackError(400, `${pg.key}: ${(e as Error).message}`);
        }
        write(m.title, m.body, sha(m.file), pg.key);
      } else if (r === 'reset' || c.hash === was) {
        // untouched by the user (or reset): the page follows the pack
        if (c.hash !== pg.hash || (pg.key !== YML && c.title !== pg.title))
          write(pg.title, pg.body, pg.hash, pg.key);
        else hashes[c.id] = pg.hash;
      } else if (pg.hash === c.hash)
        hashes[c.id] = pg.hash; // the user's text equals the new pack
      else {
        hashes[c.id] = was!; // the user's edit, the pack did not change: stays
        result.kept.push(pg.key);
      }
    }
  // pages of the project that the pack no longer has stay as they are
  const extra = [...p.cur.keys()].filter((k) => !p.pages.some((x) => x.key === k));
  for (const k of extra) hashes[p.cur.get(k)!.id] = p.live!.hashes[p.cur.get(k)!.id] ?? '';

  if (muts.length) await core.execute(userId, muts, { system: true });
  await db
    .insert(P)
    .values({
      id: p.loaded?.id ?? uuidv7(),
      projectId,
      packKey: o.packKey,
      rootPageId: rootId,
      hashes,
    })
    .onConflictDoUpdate({
      target: [P.projectId, P.packKey],
      set: { rootPageId: rootId, hashes, updatedAt: sql`now()` },
    });
  return { status: 'ok' as const, packKey: o.packKey, rootPageId: rootId, ...result, extra };
}

/** Files of the loaded pack as the pages are now (the reverse of the layout). */
export async function exportPack(db: Db, projectId: string, packKey: string): Promise<Buffer> {
  const [p] = await db
    .select()
    .from(P)
    .where(sql`${P.projectId} = ${projectId}::uuid and ${P.packKey} = ${packKey}`);
  if (!p || !(await alive(db, p.rootPageId))) throw new PackError(404, 'Пакет не найден в проекте');
  const cur = await currentPages(db, p.rootPageId!);
  const yml = cur.get(YML);
  if (!yml) throw new PackError(409, 'На странице пакета нет блока harness.yml');
  const files: PackFiles = { [YML]: yml.file };
  for (const [k, c] of cur) if (k !== YML) files[`actions/${k}.md`] = c.file;
  return zipFiles(files);
}
