import type { Row } from '@planar/shared';

/**
 * Jump to a comment (PLNRAPP-214): what the feed has to open so that it is on screen.
 * `thread` — a reply to a reply and deeper lives in the thread of its parent (PLNRAPP-201);
 * `unfold` — the comment and its ancestors (a collapsed branch hides it). null — not in the replica yet.
 */
export function commentJump(
  comments: Pick<Row<'comments'>, 'id' | 'parentId'>[],
  id: string,
): { thread: string | null; unfold: string[] } | null {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const chain: string[] = [];
  for (
    let c = byId.get(id);
    c && !chain.includes(c.id);
    c = c.parentId ? byId.get(c.parentId) : undefined
  )
    chain.push(c.id);
  if (!chain.length) return null;
  return { thread: chain.length > 2 ? chain[1] : null, unfold: chain };
}
