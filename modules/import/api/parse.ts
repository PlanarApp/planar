import type { FileFormat, ImportPreset, Mapping, Preview } from '../shared/index.js';
import { parseCsv } from './csv.js';

/** Normalized import row; undefined — field not mapped (leave alone), null — mapped but empty. */
export interface Item {
  /** row number for the report: CSV — as in the table (header = 1), Trello — the card number */
  row: number;
  externalId?: string;
  title: string;
  description?: string | null;
  /** description as HTML (Plane API): takes precedence over description */
  descriptionHtml?: string;
  status?: string;
  assignees?: string[];
  labels?: string[];
  dueDate?: string | null;
  startDate?: string | null;
  priority?: number;
  parentExt?: string;
  /** value of the project column (mapped and non-empty) */
  project?: string;
  projectKey?: string;
  /** html — the comment as HTML (Plane API) instead of text */
  comments?: { text: string; html?: string; author: string; at: string }[];
  checklist?: { text: string; done: boolean }[];
  /** Plane API: ids of the issue for its files, its attachments */
  plane?: {
    project: string;
    issue: string;
    attachments: { id: string; name: string; mime: string }[];
  };
  notes: string[];
  /** reason the row cannot be imported */
  skip?: string;
}

export interface Parsed {
  columns: string[];
  /** raw rows for the preview */
  rows: string[][];
  items: Item[];
}

export class ParseError extends Error {}

// header candidates (case-insensitive): the template first, then common synonyms
const GENERIC: Record<
  keyof Omit<Mapping, 'statusMap' | 'statusNew' | 'projectMap' | 'userMap'>,
  string[]
> = {
  externalId: ['id', 'task id', 'issue id', 'key', 'issue key'],
  title: ['title', 'name', 'summary', 'task name'],
  description: ['description', 'task content', 'content', 'body'],
  status: ['status', 'state'],
  assignee: ['assignee', 'assignees', 'assigned to', 'owner'],
  labels: ['labels', 'label', 'tags', 'tag'],
  dueDate: ['due date', 'due', 'deadline'],
  startDate: ['start date', 'start', 'started at'],
  priority: ['priority'],
  parent: ['parent id', 'parent', 'parent issue', 'parent task'],
  // projects and comments — by the source preset only: a project column in Jira must not split the import
  project: [],
  projectKey: [],
  comments: [],
};
const PRESET_COLS: Record<string, Partial<Record<keyof typeof GENERIC, string[]>>> = {
  clickup: { externalId: ['task id'], title: ['task name'], description: ['task content'] },
  jira: {
    externalId: ['issue id'],
    title: ['summary'],
    parent: ['parent id', 'parent'],
    startDate: ['custom field (start date)'],
  },
  linear: { externalId: ['id'], title: ['title'], parent: ['parent issue'] },
  plane: {
    externalId: ['identifier'],
    title: ['name'],
    status: ['state name'],
    dueDate: ['target date'],
    parent: ['parent'],
    project: ['project name'],
    projectKey: ['project identifier'],
    comments: ['comments'],
  },
};

/** header for matching: case and `_` do not matter (Plane JSON — snake_case) */
const norm = (c: string) => c.trim().toLowerCase().replace(/_/g, ' ');

export function suggestMapping(columns: string[], preset: ImportPreset): Mapping {
  const low = new Map<string, string>();
  for (const c of columns) if (!low.has(norm(c))) low.set(norm(c), c);
  const out: Record<string, string> = {};
  for (const f of Object.keys(GENERIC) as (keyof typeof GENERIC)[]) {
    for (const cand of [...(PRESET_COLS[preset]?.[f] ?? []), ...GENERIC[f]]) {
      const hit = low.get(cand);
      if (hit) {
        out[f] = hit;
        break;
      }
    }
  }
  // without a title header candidate, title stays empty: the wizard will require a column to be chosen
  return { title: columns[0] ?? '', ...out };
}

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? dt.toISOString().slice(0, 10)
    : null;
};

/**
 * Date → YYYY-MM-DD or null. Formats: ISO, Unix (ms/s), Jira `14/Feb/26 10:30 AM`, `MM/DD/YYYY` (as in ClickUp, US),
 * `DD.MM.YYYY`, otherwise — Date.parse.
 * shortcut: time and time zone are dropped (the date as written / in UTC for Unix); when a zone is needed, read it from settings.
 */
export function parseDate(s: string): string | null {
  s = s.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s))) return ymd(+m[1]!, +m[2]!, +m[3]!);
  if (/^\d{9,13}$/.test(s)) {
    const n = +s;
    return new Date(s.length >= 12 ? n : n * 1000).toISOString().slice(0, 10);
  }
  if ((m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/.exec(s))) {
    const mon = MON.indexOf(m[2]!.toLowerCase()) + 1;
    const y = +m[3]! < 100 ? 2000 + +m[3]! : +m[3]!;
    return mon ? ymd(y, mon, +m[1]!) : null;
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return ymd(+m[3]!, +m[1]!, +m[2]!);
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) return ymd(+m[3]!, +m[2]!, +m[1]!);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

// 1 = urgent … 4 = low, 0 = none (as in the UI)
const PRIORITY: Record<string, number> = {
  none: 0,
  'no priority': 0,
  urgent: 1,
  critical: 1,
  blocker: 1,
  highest: 1,
  high: 2,
  major: 2,
  medium: 3,
  normal: 3,
  low: 4,
  minor: 4,
  lowest: 4,
  trivial: 4,
};
export function parsePriority(s: string): number | null {
  s = s.trim().toLowerCase();
  if (/^[0-4]$/.test(s)) return +s;
  return PRIORITY[s] ?? null;
}

/** `["a", "b"]` (Plane, JSON), `[a, b]` (ClickUp), `a,b`, `a; b` → a list without empties. */
export function splitList(s: string): string[] {
  if (s.startsWith('["') || s === '[]') {
    try {
      const a: unknown = JSON.parse(s);
      if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      // not JSON — split as text
    }
  }
  return s
    .replace(/^\[|\]$/g, '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Table from CSV or from a JSON array of objects (Plane JSON export): columns — keys in order of appearance,
 * null → empty, arrays and objects → JSON (lists and comments parse it back).
 */
function table(text: string): string[][] {
  const t = text.replace(/^﻿/, '').trimStart();
  if (!t.startsWith('[')) return parseCsv(text);
  let a: unknown;
  try {
    a = JSON.parse(t);
  } catch {
    throw new ParseError('Не JSON');
  }
  if (!Array.isArray(a) || a.some((x) => !x || typeof x !== 'object' || Array.isArray(x)))
    throw new ParseError('JSON: ожидается массив объектов');
  if (!a.length) return [];
  const cols = [...new Set(a.flatMap((o) => Object.keys(o as object)))];
  const cell = (v: unknown) =>
    v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return [cols, ...a.map((o) => cols.map((c) => cell((o as Record<string, unknown>)[c])))];
}

/** Plane comments: `[{comment, created_by, created_at}]`; not such JSON → null */
function parseComments(s: string): Item['comments'] | null {
  try {
    const a: unknown = JSON.parse(s);
    if (!Array.isArray(a)) return null;
    return a
      .filter((c) => c && typeof c === 'object' && typeof c.comment === 'string')
      .map((c: { comment: string; created_by?: unknown; created_at?: unknown }) => ({
        text: c.comment.trim(),
        author: typeof c.created_by === 'string' ? c.created_by.trim() : '',
        at: typeof c.created_at === 'string' ? c.created_at.trim() : '',
      }))
      .filter((c) => c.text);
  } catch {
    return null;
  }
}

function csvItems(text: string, m: Mapping): Parsed {
  const all = table(text);
  if (!all.length) throw new ParseError('Пустой файл');
  const columns = all[0]!.map((c) => c.trim());
  const data = all.slice(1);
  // repeated headers (Jira: several "Labels") are joined with commas
  const idx = (name?: string) => (name ? columns.flatMap((c, i) => (c === name ? [i] : [])) : []);
  const need = (name: string | undefined, field: string) => {
    const ix = idx(name);
    if (name && !ix.length) throw new ParseError(`Колонка «${name}» (${field}) не найдена`);
    return ix;
  };
  const cols = {
    ext: need(m.externalId, 'externalId'),
    title: need(m.title, 'title'),
    desc: need(m.description, 'description'),
    status: need(m.status, 'status'),
    assignee: need(m.assignee, 'assignee'),
    labels: need(m.labels, 'labels'),
    due: need(m.dueDate, 'dueDate'),
    start: need(m.startDate, 'startDate'),
    prio: need(m.priority, 'priority'),
    parent: need(m.parent, 'parent'),
    project: need(m.project, 'project'),
    projectKey: need(m.projectKey, 'projectKey'),
    comments: need(m.comments, 'comments'),
  };
  if (!cols.title.length) throw new ParseError('Не выбрана колонка заголовка');
  const items = data.map((r, i): Item => {
    const get = (ix: number[]) =>
      ix
        .map((j) => (r[j] ?? '').trim())
        .filter(Boolean)
        .join(',');
    const it: Item = { row: i + 2, title: get(cols.title), notes: [] };
    if (!it.title) it.skip = 'нет заголовка';
    const date = (ix: number[], key: 'dueDate' | 'startDate') => {
      if (!ix.length) return;
      const v = get(ix);
      if (!v) return void (it[key] = null);
      const d = parseDate(v);
      if (!d) it.notes.push(`не удалось разобрать дату «${v}»`);
      it[key] = d;
    };
    if (cols.ext.length && get(cols.ext)) it.externalId = get(cols.ext);
    if (cols.desc.length) it.description = r[cols.desc[0]!]?.trim() || null;
    if (cols.status.length) it.status = get(cols.status);
    if (cols.assignee.length) it.assignees = splitList(get(cols.assignee));
    if (cols.labels.length) it.labels = splitList(get(cols.labels));
    date(cols.due, 'dueDate');
    date(cols.start, 'startDate');
    if (cols.prio.length && get(cols.prio)) {
      const p = parsePriority(get(cols.prio));
      if (p === null) it.notes.push(`неизвестный приоритет «${get(cols.prio)}»`);
      else it.priority = p;
    }
    if (cols.parent.length && get(cols.parent)) it.parentExt = get(cols.parent);
    if (cols.project.length && get(cols.project)) it.project = get(cols.project);
    if (cols.projectKey.length && get(cols.projectKey)) it.projectKey = get(cols.projectKey);
    const cm = cols.comments.length ? (r[cols.comments[0]!] ?? '').trim() : '';
    if (cm) {
      const c = parseComments(cm);
      if (c) it.comments = c;
      else it.notes.push('комментарии не разобраны: ожидается JSON-массив');
    }
    return it;
  });
  return { columns, rows: data, items };
}

interface TrelloBoard {
  lists?: { id: string; name: string }[];
  cards?: {
    id: string;
    name?: string;
    desc?: string;
    idList?: string;
    idLabels?: string[];
    idMembers?: string[];
    idChecklists?: string[];
    due?: string | null;
    start?: string | null;
    closed?: boolean;
  }[];
  labels?: { id: string; name?: string; color?: string | null }[];
  members?: { id: string; username?: string }[];
  checklists?: { id: string; checkItems?: { name: string; state?: string; pos?: number }[] }[];
}

/** Trello JSON: fixed mapping — cards, lists → statuses, labels, members (by username), checklists. */
function trelloItems(text: string): Parsed {
  let b: TrelloBoard;
  try {
    b = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new ParseError('Не JSON');
  }
  if (!b || !Array.isArray(b.cards))
    throw new ParseError('Нет массива cards: это не экспорт доски Trello');
  const by = <T extends { id: string }>(a: T[] | undefined) =>
    new Map((a ?? []).map((x) => [x.id, x]));
  const lists = by(b.lists);
  const labels = by(b.labels);
  const members = by(b.members);
  const checklists = by(b.checklists);
  const items: Item[] = [];
  const rows: string[][] = [];
  b.cards.forEach((c, i) => {
    const list = lists.get(c.idList ?? '')?.name ?? '';
    const lbls = (c.idLabels ?? [])
      .map((id) => {
        const l = labels.get(id);
        return (l?.name || l?.color || '').trim();
      })
      .filter(Boolean);
    const who = (c.idMembers ?? []).map((id) => members.get(id)?.username ?? '').filter(Boolean);
    rows.push([c.id, c.name ?? '', list, lbls.join(', '), who.join(', '), c.due ?? '']);
    const it: Item = {
      row: i + 1,
      externalId: c.id,
      title: (c.name ?? '').trim(),
      description: c.desc?.trim() || null,
      status: list,
      assignees: who,
      labels: lbls,
      dueDate: null,
      startDate: null,
      checklist: (c.idChecklists ?? []).flatMap((id) =>
        [...(checklists.get(id)?.checkItems ?? [])]
          .sort((x, y) => (x.pos ?? 0) - (y.pos ?? 0))
          .map((k) => ({ text: k.name, done: k.state === 'complete' })),
      ),
      notes: [],
    };
    for (const k of ['due', 'start'] as const) {
      const v = c[k];
      if (!v) continue;
      const d = parseDate(v);
      if (d) it[k === 'due' ? 'dueDate' : 'startDate'] = d;
      else it.notes.push(`не удалось разобрать дату «${v}»`);
    }
    if (c.closed) it.skip = 'карточка в архиве';
    else if (!it.title) it.skip = 'нет заголовка';
    items.push(it);
  });
  return { columns: ['id', 'name', 'list', 'labels', 'members', 'due'], rows, items };
}

export const TRELLO_MAPPING: Mapping = {
  externalId: 'id',
  title: 'name',
  status: 'list',
  labels: 'labels',
  assignee: 'members',
  dueDate: 'due',
};

/** Distinct values over all rows for the wizard tables (statuses, projects, people). */
export function distinctValues(items: Item[]): Preview['values'] {
  const status = new Set<string>();
  const project = new Map<string, string | null>();
  const people = new Set<string>();
  for (const it of items) {
    if (it.skip) continue;
    if (it.status) status.add(it.status);
    if (it.project && !project.has(it.project)) project.set(it.project, it.projectKey ?? null);
    for (const a of it.assignees ?? []) people.add(a);
    for (const c of it.comments ?? []) if (c.author) people.add(c.author);
  }
  return {
    status: [...status],
    project: [...project].map(([name, key]) => ({ name, key })),
    people: [...people].sort((a, b) => a.localeCompare(b)),
  };
}

export function parseSource(
  text: string,
  format: FileFormat,
  mapping: Mapping | null,
  preset: ImportPreset,
): Parsed {
  if (format === 'trello') return trelloItems(text);
  // without a mapping (preview) — parsing by the template's suggestion
  if (!mapping) {
    const first = table(text)[0];
    if (!first) throw new ParseError('Пустой файл');
    mapping = suggestMapping(
      first.map((c) => c.trim()),
      preset,
    );
  }
  return csvItems(text, mapping);
}
