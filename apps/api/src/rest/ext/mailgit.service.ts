import { eq, sql } from 'drizzle-orm';
import { decrypt, secretKey } from '@planar/server-kit';
import { gitlabConnections as P } from '@planar/module-gitlab/api/schema';
import { HttpError } from '../../auth/errors.js';
import { enabledModules } from '../../modules/enabled.js';
import { findTask } from './tasks.service.js';
import type { ExtDeps } from './types.js';

const unavailable = (m: string) => new HttpError(502, 'unavailable', m);

/** 404 module_disabled unless the shared module is on in the workspace */
export async function sharedOn(d: ExtDeps, module: string) {
  if (!(await enabledModules(d.db)).has(module))
    throw new HttpError(404, 'module_disabled', `Модуль ${module} выключен`);
}

/** the task (404 if hidden), its key and the GitLab connections of its project; write — not a guest */
export async function gitTask(d: ExtDeps, userId: string, ref: string, write: boolean) {
  const t = await findTask(d, userId, ref);
  await d.moduleOn(userId, 'gitlab', t.projectId);
  const r = await d.db.execute(
    sql`select p.key || '-' || ${t.number}::int as key, project_role(${userId}::uuid, ${t.projectId}::uuid) as role
        from projects p where p.id = ${t.projectId}::uuid`,
  );
  const { key, role } = r.rows[0] as { key: string; role: string | null };
  if (write && role === 'guest')
    throw new HttpError(403, 'forbidden', 'Нет прав на изменение задачи');
  const conns = await d.db
    .select()
    .from(P)
    .where(eq(P.projectId, t.projectId))
    .orderBy(P.createdAt, P.id);
  return { title: t.title, key, conns };
}

/** POST/GET to GitLab with the connection's token; the token never leaves this function */
async function gl(c: typeof P.$inferSelect, token: string, path: string, body?: object) {
  const res = await fetch(
    `${c.baseUrl.replace(/\/+$/, '')}/api/v4/projects/${c.gitlabProjectId}${path}`,
    {
      ...(body && { method: 'POST', body: JSON.stringify(body) }),
      headers: { 'PRIVATE-TOKEN': token, ...(body && { 'content-type': 'application/json' }) },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => {
    throw unavailable('GitLab недоступен');
  });
  if (res.status === 401 || res.status === 403)
    throw unavailable('GitLab отклонил токен или не хватает прав');
  if (res.status === 429) throw unavailable('GitLab ограничил запросы');
  return res;
}

/** branch named by the task key from the default branch (an existing one is reused) and, with `mr`, an MR from it */
export async function makeBranch(
  d: ExtDeps,
  userId: string,
  ref: string,
  connectionId: string | undefined,
  mr: boolean,
) {
  const { title, key, conns } = await gitTask(d, userId, ref, true);
  const c = connectionId ? conns.find((x) => x.id === connectionId) : conns[0];
  if (!c) throw new HttpError(404, 'not_found', 'Репозиторий не подключён к проекту');
  const sk = secretKey();
  if (!sk) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
  let token: string;
  try {
    token = decrypt(c.tokenEnc, sk);
  } catch {
    throw new HttpError(503, 'unavailable', 'Токен GitLab не расшифровывается');
  }
  const repo = await gl(c, token, '');
  if (!repo.ok) throw unavailable('GitLab недоступен');
  const p = (await repo.json()) as { default_branch: string; web_url: string };
  // 400 — branch already exists
  const b = await gl(c, token, '/repository/branches', { branch: key, ref: p.default_branch });
  if (!b.ok && b.status !== 400) throw unavailable('GitLab недоступен');
  if (!mr) return { webUrl: `${p.web_url}/-/tree/${encodeURIComponent(key)}` };
  const m = await gl(c, token, '/merge_requests', {
    source_branch: key,
    target_branch: p.default_branch,
    title: `${key}: ${title}`,
  });
  if (m.status === 409) throw new HttpError(409, 'conflict', 'MR из этой ветки уже есть');
  if (!m.ok) throw unavailable('GitLab недоступен');
  return { webUrl: ((await m.json()) as { web_url: string }).web_url };
}
