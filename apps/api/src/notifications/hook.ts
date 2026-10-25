import { eq } from 'drizzle-orm';
import { extractMentions, uuidv7 } from '@planar/shared';
import * as schema from '../db/schema.js';
import { ServerTx, type Q, type ServerTxCtx } from '../sync/server-tx.js';

type Kind = 'assigned' | 'mentioned' | 'commented' | 'status_changed' | 'comment_assigned';

/**
 * Уведомления и автоподписка по записям мутации (C-schema v10 «notifications»).
 * Вызывать в той же транзакции после run. Возвращает id созданных уведомлений и
 * ServerTx хука (его finish() — оповещение о записанном).
 */
export async function notificationsHook(
  q: Q,
  source: ServerTx,
  ctx: ServerTxCtx,
): Promise<{ ids: string[]; tx: ServerTx }> {
  const sys = ServerTx.asSystem(q, ctx);
  const actor = ctx.userId;
  const createdAt = ctx.now ?? new Date().toISOString();
  const members = new Map<string, Set<string>>();
  const watchers = new Map<string, Set<string>>();
  const ids: string[] = [];

  const membersOf = async (spaceId: string) => {
    let m = members.get(spaceId);
    if (!m) {
      const rows = await q
        .select({ u: schema.spaceMembers.userId })
        .from(schema.spaceMembers)
        .where(eq(schema.spaceMembers.spaceId, spaceId));
      members.set(spaceId, (m = new Set(rows.map((r) => r.u))));
    }
    return m;
  };
  const watchersOf = async (taskId: string) => {
    let w = watchers.get(taskId);
    if (!w) {
      const rows = await q
        .select({ u: schema.taskWatchers.userId })
        .from(schema.taskWatchers)
        .where(eq(schema.taskWatchers.taskId, taskId));
      watchers.set(taskId, (w = new Set(rows.map((r) => r.u))));
    }
    return w;
  };
  const subscribe = async (spaceId: string, taskId: string, userId: string) => {
    const w = await watchersOf(taskId);
    if (w.has(userId)) return;
    w.add(userId);
    await sys.put('taskWatchers', { id: uuidv7(), spaceId, taskId, userId, createdAt });
  };
  const notify = async (
    kind: Kind,
    spaceId: string,
    taskId: string,
    userId: string,
    commentId: string | null,
    changes: Record<string, unknown> | null = null,
  ) => {
    if (userId === actor || !(await membersOf(spaceId)).has(userId)) return;
    const id = uuidv7();
    await sys.put('notifications', {
      id,
      userId,
      spaceId,
      kind,
      taskId,
      url: null,
      body: null,
      commentId,
      changes,
      actorId: actor,
      readAt: null,
      createdAt,
    });
    ids.push(id);
  };

  // автоподписка до рассылки: новый исполнитель/автор уже наблюдатели
  for (const w of source.writes) {
    const a = w.after;
    if (w.op !== 'put' || !a || w.before) continue;
    const spaceId = a.spaceId as string;
    if (w.entity === 'tasks') await subscribe(spaceId, a.id as string, actor);
    else if (w.entity === 'comments') await subscribe(spaceId, a.taskId as string, actor);
    else if (w.entity === 'taskAssignees' && (await membersOf(spaceId)).has(a.userId as string))
      await subscribe(spaceId, a.taskId as string, a.userId as string);
  }

  for (const w of source.writes) {
    const a = w.after;
    if (w.op !== 'put' || !a) continue;
    const spaceId = a.spaceId as string;
    if (w.entity === 'taskAssignees' && !w.before) {
      await notify('assigned', spaceId, a.taskId as string, a.userId as string, null);
    } else if (w.entity === 'tasks') {
      // упоминание в описании — как в комментарии: только новым упомянутым
      const old = new Set(w.before ? extractMentions(w.before.description) : []);
      for (const u of extractMentions(a.description).filter((u) => !old.has(u)))
        await notify('mentioned', spaceId, a.id as string, u, null);
      if (w.before && w.before.statusId !== a.statusId)
        for (const u of await watchersOf(a.id as string))
          await notify('status_changed', spaceId, a.id as string, u, null, {
            statusId: [w.before.statusId, a.statusId],
          });
    } else if (w.entity === 'comments') {
      const taskId = a.taskId as string;
      const all = (a.mentions as string[]) ?? [];
      const old = new Set((w.before?.mentions as string[] | undefined) ?? []);
      for (const u of all.filter((u) => !old.has(u)))
        await notify('mentioned', spaceId, taskId, u, a.id as string);
      if (!w.before)
        for (const u of await watchersOf(taskId))
          if (!all.includes(u) && u !== a.assigneeId)
            await notify('commented', spaceId, taskId, u, a.id as string);
      // назначенный комментарий — исполнителю (новый или сменившийся)
      if (a.assigneeId && a.assigneeId !== w.before?.assigneeId)
        await notify('comment_assigned', spaceId, taskId, a.assigneeId as string, a.id as string);
    }
  }
  return { ids, tx: sys };
}
