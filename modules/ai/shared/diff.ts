export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

/** Line diff by LCS (O(n·m)): documents are small; the text is capped by the caller. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const t = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      t[i]![j] = x[i] === y[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ type: 'same', text: x[i++]! });
      j++;
    } else if (j < y.length && (i === x.length || t[i]![j + 1]! >= t[i + 1]![j]!))
      out.push({ type: 'add', text: y[j++]! });
    else out.push({ type: 'del', text: x[i++]! });
  }
  return out;
}
