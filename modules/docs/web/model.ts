import { rankBetween } from '@planar/web/modules';

export interface PageRow {
  id: string;
  spaceId: string;
  parentId: string | null;
  rank: string;
  title: string;
  icon: string | null;
  text: string;
  archivedAt: string | null;
}
export interface LockRow {
  id: string;
  userId: string;
  expiresAt: string;
}
export interface TreeNode {
  page: PageRow;
  depth: number;
}

const byRank = (a: PageRow, b: PageRow) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

/** Неархивные страницы пространства, обход в глубину: родитель перед детьми, дети по rank. */
export function buildTree(pages: PageRow[], spaceId: string, open?: Set<string>): TreeNode[] {
  const live = pages.filter((p) => p.spaceId === spaceId && !p.archivedAt);
  const ids = new Set(live.map((p) => p.id));
  const kids = new Map<string | null, PageRow[]>();
  for (const p of live) {
    // сирота (родитель в архиве/не загружен) показывается в корне
    const k = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    (kids.get(k) ?? kids.set(k, []).get(k)!).push(p);
  }
  const out: TreeNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of (kids.get(parent) ?? []).sort(byRank)) {
      out.push({ page: p, depth });
      if (!open || open.has(p.id)) walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export type DropZone = 'before' | 'after' | 'into';

/** Аргументы docs.page.move для переноса `id` на `target`; null — цикл или бессмыслица. */
export function moveArgs(
  pages: PageRow[],
  id: string,
  target: string,
  zone: DropZone,
): { id: string; parentId: string | null; rank: string } | null {
  const t = pages.find((p) => p.id === target);
  if (!t || id === target) return null;
  const parentId = zone === 'into' ? t.id : t.parentId;
  // цель не должна лежать внутри переносимой страницы
  for (let p: PageRow | undefined = t, n = 0; p && n < 1000; n++, p = pages.find((x) => x.id === p!.parentId))
    if (p.parentId === id) return null;
  const sib = pages
    .filter((p) => p.spaceId === t.spaceId && p.parentId === parentId && !p.archivedAt && p.id !== id)
    .sort(byRank);
  if (zone === 'into') return { id, parentId, rank: rankBetween(sib.at(-1)?.rank ?? null, null) };
  const i = sib.findIndex((p) => p.id === target);
  const [a, b] = zone === 'before' ? [sib[i - 1], sib[i]] : [sib[i], sib[i + 1]];
  return { id, parentId, rank: rankBetween(a?.rank ?? null, b?.rank ?? null) };
}

export const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Все слова запроса — подстроки названия или текста; названия выше. */
export function searchPages(pages: PageRow[], q: string, limit: number): PageRow[] {
  const ws = norm(q).split(/\s+/).filter(Boolean);
  if (!ws.length) return [];
  const hit: [number, PageRow][] = [];
  for (const p of pages) {
    if (p.archivedAt) continue;
    const t = norm(p.title);
    const all = `${t}\n${norm(p.text)}`;
    if (ws.every((w) => all.includes(w))) hit.push([ws.every((w) => t.includes(w)) ? 0 : 1, p]);
  }
  return hit
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map((h) => h[1]);
}

/** Чужая действующая блокировка → её владелец; иначе null. Время — по Date.now(). */
export const lockedBy = (lock: LockRow | undefined, me: string, now = Date.now()): string | null =>
  lock && lock.userId !== me && Date.parse(lock.expiresAt) > now ? lock.userId : null;

export const LOCK_RENEW_MS = 60_000;
export const SAVE_DEBOUNCE_MS = 800;
