import type { TimeEntry } from '../shared/index.js';

export interface TaskNode {
  id: string;
  parentId: string | null;
}

/** A task and all its descendants (recursive, without looping). */
export function subtreeIds(tasks: TaskNode[], rootId: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const t of tasks)
    if (t.parentId) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t.id]);
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length)
    for (const c of kids.get(stack.pop()!) ?? [])
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
  return out;
}

/** Seconds of an entry: the ready duration, or «now − start» for a running one. */
export const entrySec = (e: TimeEntry, nowMs: number): number =>
  e.endedAt
    ? (e.durationSec ?? 0)
    : Math.max(0, Math.floor((nowMs - Date.parse(e.startedAt)) / 1000));

/** The sum of own entries over a set of tasks. */
export const sumSec = (entries: TimeEntry[], taskIds: Set<string>, userId: string, nowMs: number) =>
  entries.reduce(
    (s, e) => (e.userId === userId && taskIds.has(e.taskId) ? s + entrySec(e, nowMs) : s),
    0,
  );

/** «1:05:09» / «5:09» for the timer. */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** «1:30» (hours:minutes); 0 → empty. */
export const hm = (sec: number): string =>
  sec <= 0
    ? ''
    : `${Math.floor(sec / 3600)}:${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`;

// working day and week, as in Jira: 1d = 8h, 1w = 5d (PLNRAPP-145)
const UNIT = { m: 60, h: 3600, d: 8 * 3600, w: 40 * 3600 } as const;

/** Duration input: «1w 2d 3h 30m» (Xm|h|d|w), «1:30» or «1.5» / «1,5» (hours). Empty → 0, junk → null. */
export function parseHm(s: string): number | null {
  const v = s.trim().toLowerCase().replaceAll(',', '.');
  if (!v) return 0;
  let m = /^(\d+):([0-5]?\d)$/.exec(v);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = /^(\d+(?:\.\d+)?)$/.exec(v);
  if (m) return Math.round(Number(m[1]) * 3600);
  if (!/^(\s*\d+(?:\.\d+)?\s*[mhdw])+$/.test(v)) return null;
  let sec = 0;
  for (const [, n, u] of v.matchAll(/(\d+(?:\.\d+)?)\s*([mhdw])/g))
    sec += Number(n) * UNIT[u as keyof typeof UNIT];
  return Math.round(sec);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local date YYYY-MM-DD. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The seven local days of the week containing `anchor`; weekStart: 0 — Sun, 1 — Mon. */
export function weekDays(anchor: Date, weekStart: 0 | 1): Date[] {
  const shift = (anchor.getDay() - weekStart + 7) % 7;
  return Array.from(
    { length: 7 },
    (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - shift + i, 12),
  );
}

export type TimeOp = {
  name: 'time.log' | 'time.update' | 'time.delete';
  args: Record<string, unknown>;
};

/**
 * Editing a cell (task × day): the new day total → mutations.
 * More — the difference is added with time.log (chunks ≤ 24 h); less — it is taken from the manual entries
 * of the day, starting from the last: whole (delete) or shortened (update); 0 — all completed
 * entries of the day are removed. If there are not enough manual entries, as many as exist are taken.
 */
export function planCell(
  cell: TimeEntry[],
  targetSec: number,
  dayStartIso: string,
  newId: () => string,
  taskId: string,
): TimeOp[] {
  const done = cell.filter((e) => e.endedAt);
  const cur = done.reduce((s, e) => s + (e.durationSec ?? 0), 0);
  const ops: TimeOp[] = [];
  if (targetSec === 0) return done.map((e) => ({ name: 'time.delete', args: { id: e.id } }));
  let diff = targetSec - cur;
  if (diff > 0) {
    for (let at = Date.parse(dayStartIso); diff > 0; diff -= 86400, at += 86400_000)
      ops.push({
        name: 'time.log',
        args: {
          id: newId(),
          taskId,
          startedAt: new Date(at).toISOString(),
          durationSec: Math.min(diff, 86400),
        },
      });
    return ops;
  }
  let cut = -diff;
  const manual = done
    .filter((e) => e.source === 'manual')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const e of manual) {
    if (cut <= 0) break;
    const d = e.durationSec ?? 0;
    if (d <= cut) {
      ops.push({ name: 'time.delete', args: { id: e.id } });
      cut -= d;
    } else {
      ops.push({ name: 'time.update', args: { id: e.id, durationSec: d - cut } });
      cut = 0;
    }
  }
  return ops;
}

type Named = { id: string; name: string };

/** Local timestamp YYYY-MM-DD HH:MM:SS. */
const stamp = (d: Date): string =>
  `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * CSV export rows (PLNRAPP-149): completed entries with the local day in [from, to] whose task passes
 * `inScope`, sorted by start — start timestamp, project, task, user name, login, minutes, note, billable.
 */
export function exportRows(
  d: {
    entries: TimeEntry[];
    tasks: { id: string; title: string; projectId: string }[];
    projects: Named[];
    users: (Named & { login: string })[];
  },
  from: string,
  to: string,
  inScope: (taskId: string) => boolean = () => true,
): string[][] {
  const task = new Map(d.tasks.map((t) => [t.id, t]));
  const project = new Map(d.projects.map((p) => [p.id, p.name]));
  const user = new Map(d.users.map((u) => [u.id, u]));
  return d.entries
    .filter((e) => e.endedAt && inScope(e.taskId))
    .map((e) => ({ e, day: dayKey(new Date(e.startedAt)) }))
    .filter(({ day }) => day >= from && day <= to)
    .sort((a, b) => a.e.startedAt.localeCompare(b.e.startedAt))
    .map(({ e }) => {
      const t = task.get(e.taskId);
      const u = user.get(e.userId);
      return [
        stamp(new Date(e.startedAt)),
        (t && project.get(t.projectId)) ?? '',
        t?.title ?? '',
        u?.name ?? '',
        u?.login ?? '',
        String(Math.round((e.durationSec ?? 0) / 60)),
        e.note ?? '',
        e.billable ? '1' : '0',
      ];
    });
}

const cell = (raw: string) => {
  // a leading = + - @ makes Excel run the cell as a formula (CSV injection) — neutralise with '
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
};

/** RFC 4180: comma, CRLF, quotes doubled; a BOM so that Excel reads UTF-8. */
export const toCsv = (rows: string[][]): string =>
  '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
