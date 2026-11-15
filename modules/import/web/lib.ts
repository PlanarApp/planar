import {
  NEW,
  guessCategory,
  type ImportPreset,
  type Mapping,
  type StatusCategory,
} from '../shared/index.js';

export const FIELDS = [
  'externalId',
  'title',
  'description',
  'status',
  'assignee',
  'labels',
  'dueDate',
  'startDate',
  'priority',
  'parent',
  'project',
  'projectKey',
  'comments',
] as const;
/** columns whose change re-reads the values over the whole file (statuses, projects, people) */
export const VALUE_FIELDS: readonly string[] = [
  'status',
  'project',
  'projectKey',
  'assignee',
  'comments',
];

/** Allowed sources for the format. */
export const presetsFor = (format: 'csv' | 'trello'): ImportPreset[] =>
  format === 'trello' ? ['trello'] : ['clickup', 'jira', 'linear', 'plane', 'custom'];

const pick = (r: Record<string, string>) =>
  Object.fromEntries(Object.entries(r).filter(([, v]) => v));

/** status choice «create with the category»: `new:<category>` (otherwise — a status id or '' — default) */
export const NEW_STATUS = 'new:';
export const newStatus = (c: StatusCategory) => NEW_STATUS + c;

/**
 * Mapping for sending: empty fields removed; statusMap (ids) and statusNew (`new:<category>`),
 * projectMap, userMap — only the chosen values and only with their column mapped.
 */
export function buildMapping(
  m: Partial<Mapping>,
  chosen: Record<string, string>,
  maps: { projects?: Record<string, string>; people?: Record<string, string> } = {},
): Mapping {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) if (m[f]) out[f] = m[f];
  const st = pick(chosen);
  const isNew = ([, v]: [string, string]) => v.startsWith(NEW_STATUS);
  const statusMap = Object.fromEntries(Object.entries(st).filter((e) => !isNew(e)));
  const statusNew = Object.fromEntries(
    Object.entries(st)
      .filter(isNew)
      .map(([k, v]) => [k, v.slice(NEW_STATUS.length)]),
  );
  if (m.status && Object.keys(statusMap).length) out.statusMap = statusMap;
  if (m.status && Object.keys(statusNew).length) out.statusNew = statusNew;
  const projectMap = pick(maps.projects ?? {});
  if (m.project && Object.keys(projectMap).length) out.projectMap = projectMap;
  const userMap = pick(maps.people ?? {});
  if ((m.assignee || m.comments) && Object.keys(userMap).length) out.userMap = userMap;
  return out as unknown as Mapping;
}

const eq = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Status hint: a status of the main project with the same name, otherwise — create with a category by the name. */
export function guessStatus(value: string, statuses: { id: string; name: string }[]): string {
  return statuses.find((s) => eq(s.name, value))?.id ?? newStatus(guessCategory(value));
}

/** Project of the file → a project of the space with the same key or name, otherwise `new`. */
export function guessProject(
  v: { name: string; key: string | null },
  projects: { id: string; name: string; key: string }[],
): string {
  return (
    projects.find((p) => eq(p.key, v.key))?.id ??
    projects.find((p) => eq(p.name, v.name))?.id ??
    NEW
  );
}

/**
 * Person of the file → a user with the same name, login or email; otherwise `new` (canCreate — instance admin)
 * or not matched ('').
 */
export function guessUser(
  name: string,
  users: { id: string; name: string; login: string; email?: string | null }[],
  canCreate = false,
): string {
  return (
    users.find((u) => eq(u.name, name) || eq(u.login, name) || eq(u.email, name))?.id ??
    (canCreate ? NEW : '')
  );
}
