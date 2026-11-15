import { Module } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { uuidv7, type BackendModuleManifest } from '@planar/shared';
import { archiveCutoff, purgeArchived, type JobApi, type JobDef } from '@planar/server-kit';
import { shared } from '../shared/index.js';
import { DocsController, versions } from './versions.js';

@Module({ controllers: [DocsController] })
class DocsModule {}

type Q = { execute(q: SQL): Promise<{ rows: unknown[] }> };
type Wire = Record<string, unknown>;
interface HookApi {
  sys: {
    get<T>(e: string, id: string): Promise<T | undefined>;
    put(e: string, row: unknown): Promise<void>;
    scan<T>(e: string, opts: { index: string; eq: unknown }): Promise<T[]>;
  };
  enqueue(job: string, data: unknown): Promise<void>;
  q: Q;
}

/** people mentioned on the page (mention node without kind='task'), no repeats */
function people(doc: unknown): string[] {
  const out = new Set<string>();
  const walk = (n: unknown) => {
    const x = n as { type?: string; attrs?: { id?: string; kind?: string }; content?: unknown[] };
    if (x?.type === 'mention' && typeof x.attrs?.id === 'string' && x.attrs.kind !== 'task')
      out.add(x.attrs.id);
    x?.content?.forEach(walk);
  };
  walk(doc);
  return [...out];
}

type Kind = 'doc_mention' | 'doc_comment_assigned';

/** Sends to the space members who see the page (PJ-11: project_role), never to the author of the change. */
async function send(
  api: HookApi,
  ctx: { userId: string; now: string },
  page: Wire,
  users: string[],
  kind: Kind,
  url: string,
) {
  const fresh = users.filter((u) => u !== ctx.userId);
  if (!fresh.length) return;
  const spaceId = page.spaceId as string;
  const members = new Set(
    (await api.sys.scan<{ userId: string }>('spaceMembers', { index: 'spaceId', eq: spaceId })).map(
      (m) => m.userId,
    ),
  );
  const author = await api.sys.get<{ name: string }>('users', ctx.userId);
  const title = String(page.title || '…');
  for (const userId of fresh.filter((u) => members.has(u))) {
    // PJ-11: a page of a project hidden from the user does not notify them (rule — SQL function project_role)
    if (page.projectId) {
      const r = await api.q.execute(
        sql`select project_role(${userId}::uuid, ${String(page.projectId)}::uuid) as r`,
      );
      if (!(r.rows[0] as { r: unknown } | undefined)?.r) continue;
    }
    const id = uuidv7();
    await api.sys.put('notifications', {
      id,
      userId,
      spaceId,
      kind,
      taskId: null,
      commentId: null,
      changes: null,
      actorId: ctx.userId,
      readAt: null,
      createdAt: ctx.now,
      url,
      body: `${author?.name ?? ''}: ${title}`.slice(0, 140),
    });
    await api.enqueue('push.notification', { notificationId: id });
  }
}

/**
 * A mention on the page or in its comment — doc_mention to newly mentioned space members (not to the author);
 * a comment assigned to someone new — doc_comment_assigned (PLNRAPP-209).
 */
async function notify(
  writes: { entity: string; op: string; before: Wire | null; after: Wire | null }[],
  ctx: { userId: string; now: string },
  api: HookApi,
) {
  for (const w of writes) {
    if (w.op !== 'put' || !w.after) continue;
    if (w.entity === 'docsPages') {
      if (w.after.archivedAt) continue;
      const old = new Set(w.before ? people(w.before.body) : []);
      const fresh = people(w.after.body).filter((u) => !old.has(u));
      await send(api, ctx, w.after, fresh, 'doc_mention', `/m/docs/${String(w.after.id)}`);
    } else if (w.entity === 'docsComments') {
      const page = await api.sys.get<Wire>('docsPages', String(w.after.pageId));
      if (!page || page.archivedAt) continue;
      const url = `/m/docs/${String(page.id)}?comment=${String(w.after.id)}`;
      const old = new Set(w.before ? people(w.before.body) : []);
      const fresh = people(w.after.body).filter((u) => !old.has(u));
      await send(api, ctx, page, fresh, 'doc_mention', url);
      const to = w.after.assigneeId as string | null;
      if (to && to !== w.before?.assigneeId)
        await send(api, ctx, page, [to], 'doc_comment_assigned', url);
    }
  }
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: DocsModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: (async (writes, ctx, api: HookApi) => {
    await notify(writes, ctx, api);
    await versions(writes, ctx, api.q);
  }) as BackendModuleManifest['afterMutation'],
  // PLNRAPP-154: archived pages older than ARCHIVE_DAYS; roots only — docs.page.delete takes the subtree
  jobs: [
    {
      queue: 'docs.archive.purge',
      cron: '25 3 * * *',
      handler: (_: unknown, a: JobApi) =>
        purgeArchived(
          a,
          'docs.page.delete',
          sql`select p.id from docs_pages p where p.archived_at < ${archiveCutoff} and not exists
            (select 1 from docs_pages x where x.id = p.parent_id and x.archived_at < ${archiveCutoff})`,
        ),
    },
  ] as JobDef<never>[],
  // a file on the user's space page, uploaded by a member of that space
  async canReadFile(q, userId, sha256) {
    const r = await (q as Q).execute(sql`
      select 1 from docs_pages p
      join space_members me on me.space_id = p.space_id and me.user_id = ${userId}
      where p.files @> ${JSON.stringify([sha256])}::jsonb
        and (p.project_id is null
          or (project_role(${userId}::uuid, p.project_id) is not null
            and exists (select 1 from projects pr where pr.id = p.project_id and 'docs' = any(pr.modules))))
        and exists (
          select 1 from file_uploads fu
          join space_members m on m.user_id = fu.user_id and m.space_id = p.space_id
          where fu.sha256 = ${sha256})
      limit 1`);
    return r.rows.length > 0;
  },
};
