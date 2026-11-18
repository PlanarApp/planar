// PLNRAPP-282: the diff of two page versions — by text blocks (paragraphs, headings, list items, code),
// inside a changed block by words. Only the text is compared; an image is a block with its src.

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };
export type Block = { kind: string; text: string };
export type Op = 'eq' | 'ins' | 'del';
export type Part = { op: Op; text: string };
export type DiffBlock = { op: Op | 'mod'; kind: string; parts: Part[] };

const text = (n: Node): string =>
  n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(text).join('');

/** leaf blocks of a ProseMirror doc in reading order */
export function blocks(doc: unknown): Block[] {
  const out: Block[] = [];
  const walk = (n: Node) => {
    if (n.type === 'image') return void out.push({ kind: 'image', text: String(n.attrs?.src ?? '') });
    if (n.type === 'horizontalRule') return void out.push({ kind: 'horizontalRule', text: '' });
    const kids = n.content ?? [];
    if (n.type !== 'doc' && (kids.length === 0 || kids.some((k) => k.type === 'text' || k.type === 'hardBreak')))
      return void out.push({ kind: n.type ?? '', text: text(n) });
    kids.forEach(walk);
  };
  if (doc && typeof doc === 'object') walk(doc as Node);
  return out;
}

/** LCS edit script: a → b */
export function diffSeq<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): { op: Op; a?: T; b?: T }[] {
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i]![j] = eq(a[i]!, b[j]!) ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: { op: Op; a?: T; b?: T }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && eq(a[i]!, b[j]!)) out.push({ op: 'eq', a: a[i++], b: b[j++] });
    else if (j < m && (i === n || L[i]![j + 1]! > L[i + 1]![j]!)) out.push({ op: 'ins', b: b[j++] });
    else out.push({ op: 'del', a: a[i++] });
  }
  return out;
}

const words = (s: string) => s.split(/(\s+)/).filter(Boolean);

/** word diff of two strings; neighbouring parts of one op are merged */
export function diffWords(a: string, b: string): Part[] {
  const out: Part[] = [];
  for (const d of diffSeq(words(a), words(b), (x, y) => x === y)) {
    const t = (d.op === 'ins' ? d.b : d.a)!;
    const last = out[out.length - 1];
    if (last?.op === d.op) last.text += t;
    else out.push({ op: d.op, text: t });
  }
  return out;
}

/** the diff of version `from` (older) to version `to` */
export function diffDocs(from: unknown, to: unknown): DiffBlock[] {
  const ops = diffSeq(blocks(from), blocks(to), (x, y) => x.kind === y.kind && x.text === y.text);
  const out: DiffBlock[] = [];
  for (let k = 0; k < ops.length; ) {
    if (ops[k]!.op === 'eq') {
      const b = ops[k++]!.b!;
      out.push({ op: 'eq', kind: b.kind, parts: [{ op: 'eq', text: b.text }] });
      continue;
    }
    // a run of changes: deleted blocks pair with inserted ones of the same kind → a changed block
    const del: Block[] = [];
    const ins: Block[] = [];
    for (; k < ops.length && ops[k]!.op !== 'eq'; k++)
      if (ops[k]!.op === 'del') del.push(ops[k]!.a!);
      else ins.push(ops[k]!.b!);
    const pairs = diffSeq(del, ins, (x, y) => x.kind === y.kind && x.kind !== 'image');
    for (const p of pairs)
      if (p.op === 'eq') out.push({ op: 'mod', kind: p.b!.kind, parts: diffWords(p.a!.text, p.b!.text) });
      else {
        const b = (p.op === 'ins' ? p.b : p.a)!;
        out.push({ op: p.op, kind: b.kind, parts: [{ op: p.op, text: b.text }] });
      }
  }
  return out;
}

/** number of changed blocks */
export const changes = (d: DiffBlock[]) => d.filter((b) => b.op !== 'eq').length;
