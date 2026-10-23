import { z } from 'zod';
import {
  defineMutator,
  MutatorError,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const doc = z.looseObject({ type: z.literal('doc'), content: z.array(z.unknown()).optional() });

export const docsPages = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  parentId: z.uuid().nullable(),
  rank: z.string().min(1),
  title: z.string().max(200),
  icon: z.string().min(1).max(16).nullable(),
  body: doc,
  text: z.string(),
  files: z.array(z.string()),
  createdBy: z.uuid(),
  updatedBy: z.uuid(),
  archivedAt: ts.nullable(),
  createdAt: ts,
  updatedAt: ts,
});
export const docsTaskLinks = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  pageId: z.uuid(),
  taskId: z.uuid(),
  createdBy: z.uuid(),
  createdAt: ts,
});
export const docsLocks = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  userId: z.uuid(),
  expiresAt: ts,
});

type Page = z.infer<typeof docsPages>;
type Link = z.infer<typeof docsTaskLinks>;
type Lock = z.infer<typeof docsLocks>;

// Tx типизирован сущностями ядра; сущности модулей приводим (C-modules)
interface DocsTx {
  get<T>(e: string, id: string): Promise<T | undefined>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, partial: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan<T>(e: string, opts?: { index: string; eq: unknown }): Promise<T[]>;
}
const dtx = (tx: Tx) => tx as unknown as DocsTx;

const MAX_BODY = 512 * 1024;
const MAX_TEXT = 100_000;
const SHA_SRC = /^\/files\/([0-9a-f]{64})/;

/** text-узлы body через пробел и sha256 из image-узлов; один обход. */
function derive(body: unknown): { text: string; files: string[] } {
  const texts: string[] = [];
  const files = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const o = n as { type?: unknown; text?: unknown; attrs?: { src?: unknown }; content?: unknown };
    if (o.type === 'text' && typeof o.text === 'string') texts.push(o.text);
    if (o.type === 'image' && typeof o.attrs?.src === 'string') {
      const m = SHA_SRC.exec(o.attrs.src);
      if (m) files.add(m[1]!);
    }
    if (Array.isArray(o.content)) o.content.forEach(walk);
  };
  walk(body);
  return { text: texts.join(' ').slice(0, MAX_TEXT), files: [...files] };
}

const checkBody = (body: unknown) => {
  if (JSON.stringify(body).length > MAX_BODY) throw new MutatorError('invalid_args', 'body > 512 КБ');
};

async function page(tx: Tx, id: string): Promise<Page> {
  const p = await dtx(tx).get<Page>('docsPages', id);
  if (!p) throw new MutatorError('not_found', 'страница не найдена');
  return p;
}

/** Все потомки (без самой страницы); visited защищает от цикла в испорченных данных. */
async function descendants(tx: Tx, id: string): Promise<Page[]> {
  const out: Page[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const kids = await dtx(tx).scan<Page>('docsPages', { index: 'parentId', eq: queue.shift() });
    for (const k of kids)
      if (!seen.has(k.id)) {
        seen.add(k.id);
        out.push(k);
        queue.push(k.id);
      }
  }
  return out;
}

const expiry = (now: string) => new Date(Date.parse(now) + 120_000).toISOString();

const create = defineMutator({
  name: 'docs.page.create',
  args: z.object({
    id: z.uuid(),
    spaceId: z.uuid(),
    rank: z.string().min(1),
    parentId: z.uuid().nullable().optional(),
    title: z.string().max(200).optional(),
    icon: z.string().min(1).max(16).nullable().optional(),
    body: doc.optional(),
  }),
  async run(tx, a, ctx) {
    if (a.parentId) {
      const p = await dtx(tx).get<Page>('docsPages', a.parentId);
      if (!p || p.spaceId !== a.spaceId || p.archivedAt)
        throw new MutatorError('invalid_args', 'родитель недопустим');
    }
    const body = a.body ?? { type: 'doc' as const, content: [] };
    checkBody(body);
    const row: Page = {
      id: a.id,
      spaceId: a.spaceId,
      parentId: a.parentId ?? null,
      rank: a.rank,
      title: a.title ?? '',
      icon: a.icon ?? null,
      body,
      ...derive(body),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
      archivedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    await dtx(tx).put('docsPages', row);
  },
});

const update = defineMutator({
  name: 'docs.page.update',
  args: z.object({
    id: z.uuid(),
    title: z.string().max(200).optional(),
    icon: z.string().min(1).max(16).nullable().optional(),
    body: doc.optional(),
  }),
  async run(tx, a, ctx) {
    const p = await page(tx, a.id);
    if (p.archivedAt) throw new MutatorError('conflict', 'страница в архиве');
    const patch: Partial<Page> = { updatedBy: ctx.userId, updatedAt: ctx.now };
    if (a.title !== undefined) patch.title = a.title;
    if (a.icon !== undefined) patch.icon = a.icon;
    if (a.body !== undefined) {
      checkBody(a.body);
      Object.assign(patch, { body: a.body, ...derive(a.body) });
    }
    await dtx(tx).patch('docsPages', a.id, patch);
  },
});

const move = defineMutator({
  name: 'docs.page.move',
  args: z.object({ id: z.uuid(), parentId: z.uuid().nullable(), rank: z.string().min(1) }),
  async run(tx, a, ctx) {
    const p = await page(tx, a.id);
    if (a.parentId) {
      const np = await dtx(tx).get<Page>('docsPages', a.parentId);
      if (!np) throw new MutatorError('not_found', 'родитель не найден');
      if (np.spaceId !== p.spaceId) throw new MutatorError('invalid_args', 'другое пространство');
      if (a.parentId === a.id || (await descendants(tx, a.id)).some((d) => d.id === a.parentId))
        throw new MutatorError('invalid_args', 'цикл');
      if (np.archivedAt) throw new MutatorError('conflict', 'родитель в архиве');
    }
    if (p.archivedAt) throw new MutatorError('conflict', 'страница в архиве');
    await dtx(tx).patch('docsPages', a.id, {
      parentId: a.parentId,
      rank: a.rank,
      updatedAt: ctx.now,
    });
  },
});

const archive = defineMutator({
  name: 'docs.page.archive',
  args: z.object({ id: z.uuid() }),
  async run(tx, a, ctx) {
    const p = await page(tx, a.id);
    if (p.archivedAt) return;
    const rows = [p, ...(await descendants(tx, a.id)).filter((d) => !d.archivedAt)];
    for (const r of rows)
      await dtx(tx).patch('docsPages', r.id, { archivedAt: ctx.now, updatedAt: ctx.now });
  },
});

const restore = defineMutator({
  name: 'docs.page.restore',
  args: z.object({ id: z.uuid() }),
  async run(tx, a, ctx) {
    const p = await page(tx, a.id);
    if (!p.archivedAt) return;
    const rows = [p, ...(await descendants(tx, a.id)).filter((d) => d.archivedAt === p.archivedAt)];
    const parent = p.parentId ? await dtx(tx).get<Page>('docsPages', p.parentId) : undefined;
    for (const r of rows) {
      const patch: Record<string, unknown> = { archivedAt: null, updatedAt: ctx.now };
      if (r.id === p.id && parent?.archivedAt) patch.parentId = null;
      await dtx(tx).patch('docsPages', r.id, patch);
    }
  },
});

const linkAdd = defineMutator({
  name: 'docs.link.add',
  args: z.object({ id: z.uuid(), pageId: z.uuid(), taskId: z.uuid() }),
  async run(tx, a, ctx) {
    const p = await page(tx, a.pageId);
    const t = await tx.get('tasks', a.taskId);
    if (!t || t.spaceId !== p.spaceId) throw new MutatorError('invalid_args', 'задача другого пространства');
    const links = await dtx(tx).scan<Link>('docsTaskLinks', { index: 'pageId', eq: a.pageId });
    if (links.some((l) => l.taskId === a.taskId)) return;
    const row: Link = {
      id: a.id,
      spaceId: p.spaceId,
      pageId: a.pageId,
      taskId: a.taskId,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    };
    await dtx(tx).put('docsTaskLinks', row);
  },
});

const linkRemove = defineMutator({
  name: 'docs.link.remove',
  args: z.object({ pageId: z.uuid(), taskId: z.uuid() }),
  async run(tx, a) {
    const links = await dtx(tx).scan<Link>('docsTaskLinks', { index: 'pageId', eq: a.pageId });
    for (const l of links) if (l.taskId === a.taskId) await dtx(tx).del('docsTaskLinks', l.id);
  },
});

const lock = defineMutator({
  name: 'docs.lock',
  args: z.object({ pageId: z.uuid() }),
  async run(tx, a, ctx) {
    const p = await page(tx, a.pageId);
    const cur = await dtx(tx).get<Lock>('docsLocks', a.pageId);
    if (cur && cur.userId !== ctx.userId && Date.parse(cur.expiresAt) > Date.parse(ctx.now))
      throw new MutatorError('conflict', 'страницу редактирует другой');
    const row: Lock = {
      id: a.pageId,
      spaceId: p.spaceId,
      userId: ctx.userId,
      expiresAt: expiry(ctx.now),
    };
    await dtx(tx).put('docsLocks', row);
  },
});

const unlock = defineMutator({
  name: 'docs.unlock',
  args: z.object({ pageId: z.uuid() }),
  async run(tx, a, ctx) {
    const cur = await dtx(tx).get<Lock>('docsLocks', a.pageId);
    if (cur?.userId === ctx.userId) await dtx(tx).del('docsLocks', a.pageId);
  },
});

export const shared: SharedModuleManifest = {
  id: 'docs',
  mutators: [create, update, move, archive, restore, linkAdd, linkRemove, lock, unlock],
  entities: {
    docsPages: {
      schema: docsPages,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId', 'parentId'] },
    },
    docsTaskLinks: {
      schema: docsTaskLinks,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['pageId', 'taskId'] },
    },
    docsLocks: {
      schema: docsLocks,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: [] },
    },
  },
};
