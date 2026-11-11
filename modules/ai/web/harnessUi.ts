// Pure logic of the «Apply harness» dialog and the packs section (no Vue).
import type { HarnessKind, HarnessOp } from '../shared/index.js';

// type-only import above: shared/index pulls zod, the web test environment does not resolve it
const HARNESS_KINDS: HarnessKind[] = ['status', 'label', 'field', 'action', 'rule'];

/** Title of the project's root page that holds the packs (same as PACKS_ROOT_TITLE of the api). */
export const PACKS_ROOT_TITLE = 'Harness-пакеты';

/** Ops grouped by kind, in the apply order (statuses → labels → fields → actions → rules); empty groups dropped. */
export function groupOps(ops: HarnessOp[]): { kind: HarnessKind; ops: HarnessOp[] }[] {
  return HARNESS_KINDS.map((kind) => ({ kind, ops: ops.filter((o) => o.kind === kind) })).filter(
    (g) => g.ops.length,
  );
}

/** Keys of the statuses the diff refuses to delete without `replaceWith` (error text of computeDiff). */
export function needReplace(errors: string[]): string[] {
  return errors.flatMap((e) => {
    const m = /^статус (.+?): в нём \d+ задач, нужен replaceWith$/.exec(e);
    return m ? [m[1]!] : [];
  });
}

/** Pack status keys tasks can move to: the statuses the pack creates or updates. */
export const replaceTargets = (ops: HarnessOp[]): string[] =>
  ops
    .filter((o) => o.kind === 'status' && (o.op === 'create' || o.op === 'update'))
    .map((o) => o.key);

/** The `replaceWith` of the request: only the filled entries. */
export function buildReplaceWith(picked: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(picked)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [k, v.trim()]),
  );
}

/** The page is a direct child of the packs root (a page titled «Harness-пакеты» without a parent in the project). */
export function isPackPage(
  pages: { id: string; parentId: string | null; title: string; projectId?: string | null }[],
  pageId: string,
): boolean {
  const p = pages.find((x) => x.id === pageId);
  const root = p?.parentId ? pages.find((x) => x.id === p.parentId) : undefined;
  return (
    !!p &&
    !!root &&
    !root.parentId &&
    root.title === PACKS_ROOT_TITLE &&
    root.projectId === p.projectId
  );
}

export const toBase64 = (buf: ArrayBuffer): string => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
