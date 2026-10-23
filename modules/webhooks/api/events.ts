import { and, arrayContains, eq } from 'drizzle-orm';
import type {
  AfterMutationCtx,
  CoreServices,
  ModuleHookApi,
  MutationWrite,
} from '@planar/server-kit';
import { createDelivery, QUEUE } from './deliver.js';
import { webhooksSubscriptions as S } from './schema.js';

type Row = Record<string, unknown>;
type Set = { add: string[]; del: string[] };
interface Slot {
  created?: Row;
  deleted?: Row;
  row?: Row;
  changes: Row;
  sets: Record<string, Set>;
}

// CoreServices выдаёт Nest (WebhooksBoot); хук — не провайдер
let core: CoreServices | undefined;
export const setCore = (c: CoreServices) => void (core = c);

const SKIP = new Set(['updatedAt', 'rank']);

/** Текст comments.body (документ): текстовые узлы, абзацы через \n. */
function plain(n: unknown): string {
  const x = n as { text?: string; content?: Row[] } | undefined;
  if (typeof x?.text === 'string') return x.text;
  const kids = (x?.content ?? []).map(plain);
  return kids.join(x?.content?.some((c) => c.content) ? '\n' : '');
}

/** Одно событие на задачу на мутацию → доставки активным подпискам с этим событием. */
export async function afterMutation(
  writes: MutationWrite[],
  ctx: AfterMutationCtx,
  api: ModuleHookApi,
) {
  if (!core) return;
  const tasks = new Map<string, Slot>();
  const slot = (id: string) => {
    let t = tasks.get(id);
    if (!t) tasks.set(id, (t = { changes: {}, sets: {} }));
    return t;
  };
  const comments: { taskId: string; c: Row }[] = [];
  for (const w of writes) {
    const a = (w.after ?? w.before)!;
    if (w.entity === 'tasks') {
      const t = slot(a.id as string);
      if (w.op === 'del') t.deleted = w.before!;
      else if (!w.before) t.created = w.after!;
      else {
        t.row = w.after!;
        for (const k of Object.keys(w.after!))
          if (!SKIP.has(k) && JSON.stringify(w.before[k]) !== JSON.stringify(w.after![k]))
            t.changes[k] = [w.before[k], w.after![k]];
      }
    } else if (w.entity === 'taskAssignees' || w.entity === 'taskLabels') {
      const assignee = w.entity === 'taskAssignees';
      const s = (slot(a.taskId as string).sets[assignee ? 'assigneeIds' : 'labelIds'] ??= {
        add: [],
        del: [],
      });
      (w.op === 'put' && !w.before ? s.add : s.del).push(
        (assignee ? a.userId : a.labelId) as string,
      );
    } else if (w.entity === 'comments' && w.op === 'put' && !w.before)
      comments.push({ taskId: a.taskId as string, c: w.after! });
  }

  const emit = async (event: string, data: object) => {
    const subs = await api.q
      .select({ id: S.id })
      .from(S)
      .where(and(eq(S.active, true), arrayContains(S.events, [event])));
    for (const s of subs) {
      const d = await createDelivery(api.q, s.id, event, data);
      await api.enqueue(QUEUE, { deliveryId: d.id });
    }
  };
  const v1 = async (row: Row) => (await core!.toV1Tasks(api.q, [row]))[0]!;
  const current = async (id: string, t?: Slot) =>
    t?.created ?? t?.row ?? ((await api.sys.get('tasks', id)) as Row | undefined);
  const actorId = ctx.userId;

  for (const [id, t] of tasks) {
    if (t.deleted) {
      const { key, projectId, spaceId } = await v1(t.deleted);
      await emit('task.deleted', { task: { id, key, projectId, spaceId }, actorId });
      continue;
    }
    const cur = await current(id, t);
    if (!cur) continue;
    const task = await v1(cur);
    if (t.created) {
      await emit('task.created', { task, changes: {}, actorId });
      continue;
    }
    for (const [k, s] of Object.entries(t.sets)) {
      const now = task[k] as string[];
      t.changes[k] = [[...now.filter((x) => !s.add.includes(x)), ...s.del], now];
    }
    if (Object.keys(t.changes).length)
      await emit('task.updated', { task, changes: t.changes, actorId });
  }
  for (const { taskId, c } of comments) {
    const cur = await current(taskId, tasks.get(taskId));
    if (!cur) continue;
    await emit('comment.created', {
      task: await v1(cur),
      comment: {
        id: c.id,
        taskId,
        authorId: c.authorId,
        text: plain(c.body),
        createdAt: c.createdAt,
      },
      actorId,
    });
  }
}
