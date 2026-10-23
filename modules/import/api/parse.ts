import type { ImportPreset, Mapping } from '../shared/index.js';
import { parseCsv } from './csv.js';

/** Нормализованная строка импорта; undefined — поле не сопоставлено (не трогать), null — сопоставлено, но пусто. */
export interface Item {
  /** номер строки для отчёта: CSV — как в таблице (заголовок = 1), Trello — номер карточки */
  row: number;
  externalId?: string;
  title: string;
  description?: string | null;
  status?: string;
  assignees?: string[];
  labels?: string[];
  dueDate?: string | null;
  startDate?: string | null;
  priority?: number;
  parentExt?: string;
  checklist?: { text: string; done: boolean }[];
  notes: string[];
  /** причина, по которой строку нельзя импортировать */
  skip?: string;
}

export interface Parsed {
  columns: string[];
  /** сырые строки для предпросмотра */
  rows: string[][];
  items: Item[];
}

export class ParseError extends Error {}

// кандидаты заголовков (без регистра): сначала заготовка, затем общие синонимы
const GENERIC: Record<keyof Omit<Mapping, 'statusMap'>, string[]> = {
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
};

export function suggestMapping(columns: string[], preset: ImportPreset): Mapping {
  const low = new Map<string, string>();
  for (const c of columns) if (!low.has(c.trim().toLowerCase())) low.set(c.trim().toLowerCase(), c);
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
  // без заголовка-кандидата title остаётся пустым: мастер потребует выбрать колонку
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
 * Дата → YYYY-MM-DD или null. Форматы: ISO, Unix (мс/с), Jira `14/Feb/26 10:30 AM`, `MM/DD/YYYY` (как в ClickUp, США),
 * `DD.MM.YYYY`, остальное — Date.parse.
 * shortcut: время и часовой пояс отбрасываются (дата как написана / в UTC для Unix), когда понадобится пояс — читать из настроек.
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

// 1 = срочный … 4 = низкий, 0 = нет (как в интерфейсе)
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

/** «[a, b]» (ClickUp), «a,b», «a; b» → список без пустых. */
export const splitList = (s: string): string[] =>
  s
    .replace(/^\[|\]$/g, '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

function csvItems(text: string, m: Mapping): Parsed {
  const all = parseCsv(text);
  if (!all.length) throw new ParseError('Пустой файл');
  const columns = all[0]!.map((c) => c.trim());
  const data = all.slice(1);
  // повторяющиеся заголовки (Jira: несколько «Labels») собираются через запятую
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

/** Trello JSON: сопоставление фиксированное — карточки, списки → статусы, метки, участники (по username), чек-листы. */
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

export function parseSource(
  text: string,
  format: 'csv' | 'trello',
  mapping: Mapping | null,
  preset: ImportPreset,
): Parsed {
  if (format === 'trello') return trelloItems(text);
  // без mapping (предпросмотр) — разбор по предложению заготовки
  if (!mapping) {
    const first = parseCsv(text)[0];
    if (!first) throw new ParseError('Пустой файл');
    mapping = suggestMapping(
      first.map((c) => c.trim()),
      preset,
    );
  }
  return csvItems(text, mapping);
}
