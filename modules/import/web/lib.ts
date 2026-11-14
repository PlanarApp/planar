import { NEW, type ImportPreset, type Mapping } from '../shared/index.js';

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

/**
 * Mapping for sending: empty fields removed; statusMap, projectMap, userMap — only the chosen values
 * and only with their column mapped.
 */
export function buildMapping(
  m: Partial<Mapping>,
  chosen: Record<string, string>,
  maps: { projects?: Record<string, string>; people?: Record<string, string> } = {},
): Mapping {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) if (m[f]) out[f] = m[f];
  const statusMap = pick(chosen);
  if (m.status && Object.keys(statusMap).length) out.statusMap = statusMap;
  const projectMap = pick(maps.projects ?? {});
  if (m.project && Object.keys(projectMap).length) out.projectMap = projectMap;
  const userMap = pick(maps.people ?? {});
  if ((m.assignee || m.comments) && Object.keys(userMap).length) out.userMap = userMap;
  return out as unknown as Mapping;
}

const eq = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Default status for the hint: a status name equal to the value, case-insensitively. */
export function guessStatus(value: string, statuses: { id: string; name: string }[]): string {
  return statuses.find((s) => eq(s.name, value))?.id ?? '';
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

/** Person of the file → a user with the same name, login or email, otherwise not matched (''). */
export function guessUser(
  name: string,
  users: { id: string; name: string; login: string; email?: string | null }[],
): string {
  return users.find((u) => eq(u.name, name) || eq(u.login, name) || eq(u.email, name))?.id ?? '';
}
