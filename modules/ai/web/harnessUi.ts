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

/** PLNRAPP-538: the choice for a page that differs from the pack — «mine» for a page the user edited, else the pack. */
export type PageChoice = 'keep' | 'reset' | 'merge';
export const defaultChoice = (p: { edited: boolean }): PageChoice => (p.edited ? 'keep' : 'reset');

/** Line diff of the current text against the pack's (LCS): ' ' both, '-' only current, '+' only the pack. */
export function lineDiff(a: string, b: string): { op: ' ' | '-' | '+'; text: string }[] {
  const x = a.split('\n');
  const y = b.split('\n');
  // shortcut: O(n·m) table, fine for pack pages (hundreds of lines); a long document needs Myers
  const L = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      L[i]![j] = x[i] === y[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: { op: ' ' | '-' | '+'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push({ op: ' ', text: x[i]! });
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) out.push({ op: '-', text: x[i++]! });
    else out.push({ op: '+', text: y[j++]! });
  }
  while (i < x.length) out.push({ op: '-', text: x[i++]! });
  while (j < y.length) out.push({ op: '+', text: y[j++]! });
  return out;
}

export const toBase64 = (buf: ArrayBuffer): string => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
