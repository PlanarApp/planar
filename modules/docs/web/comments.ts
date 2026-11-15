// Pure logic of the page comments (DocComments.vue, PLNRAPP-209): threads, rights of the buttons.

export interface CommentRow {
  id: string;
  spaceId: string;
  pageId: string;
  authorId: string;
  parentId: string | null;
  body: Record<string, unknown>;
  mentions: string[];
  assigneeId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const byTime = (a: CommentRow, b: CommentRow) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1;

/**
 * Threads, oldest first: a root and all of its replies of any depth in one list under it (one indent level).
 * A reply whose root is gone (deleted subtree mid-sync) is dropped.
 */
export function threads(rows: CommentRow[]): { root: CommentRow; replies: CommentRow[] }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (c: CommentRow): CommentRow | undefined => {
    const seen = new Set<string>();
    let x: CommentRow | undefined = c;
    while (x?.parentId && !seen.has(x.id)) {
      seen.add(x.id);
      x = byId.get(x.parentId);
    }
    return x && !x.parentId ? x : undefined;
  };
  const out = new Map<string, CommentRow[]>();
  for (const r of [...rows].sort(byTime)) {
    const root = rootOf(r);
    if (!root) continue;
    if (root.id === r.id) out.set(r.id, out.get(r.id) ?? []);
    else (out.get(root.id) ?? out.set(root.id, []).get(root.id)!).push(r);
  }
  return [...out].map(([id, replies]) => ({ root: byId.get(id)!, replies }));
}

/** Resolving an assigned comment: its assignee, author or an admin (as the docs.comment.resolve mutator). */
export const canResolve = (c: CommentRow, me: string | undefined, admin: boolean): boolean =>
  !!c.assigneeId && !!me && (me === c.assigneeId || me === c.authorId || admin);
