import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HttpErrorCode } from '@planar/shared';
import type { AuthCtx } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import type { RestService } from '../rest/rest.service.js';
import {
  commentBody,
  createDocBody,
  createTaskBody,
  docQuery,
  docsQuery,
  docTaskBody,
  linkBody,
  patchCommentBody,
  patchDocBody,
  patchTaskBody,
  timeEntriesQuery,
} from '../rest/schemas.js';

type Node = { text?: string; attrs?: { label?: string }; type?: string; content?: Node[] };
/** ProseMirror document → plain text (paragraphs via \n, mention → @login) */
export function docToText(doc: unknown): string | null {
  if (!doc) return null;
  const walk = (n: Node): string =>
    n.type === 'mention'
      ? `@${n.attrs?.label ?? ''}`
      : (n.text ??
        (n.content ?? []).map(walk).join(n.content?.[0]?.type === 'paragraph' ? '\n' : ''));
  return walk(doc as Node);
}

const out = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });
const fail = (code: HttpErrorCode, message: string) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text: JSON.stringify({ code, message }) }],
});

const flat = <T extends { description?: unknown }>(t: T) => ({
  ...t,
  description: docToText(t.description),
});
const cmt = <T extends { body?: unknown }>(c: T) => ({ ...c, body: docToText(c.body) });
const task = z.string().describe('id или ключ задачи, например PLN-12');

export type ToolDanger = 'delete';

/** One tool, shared by MCP and the chat adapter (modules/ai/api/chat-tools.ts). */
export interface ToolDef {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  write: boolean;
  /** needs the user's confirmation in chat */
  danger?: ToolDanger;
  /** dangerous only for some arguments (text that may come from a prompt injection) */
  dangerIf?: (args: never) => boolean;
  run(args: never, uid: string, tokenId?: string): Promise<unknown>;
}

type C = { uid: string; tokenId?: string };

/** The registry of tools; rights — of `uid` inside RestService. */
export function toolDefs(rest: RestService): ToolDef[] {
  const defs: ToolDef[] = [];
  const def = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    write: boolean,
    ...r: [f: Fn<S>] | [danger: ToolDanger | ((a: z.infer<z.ZodObject<S>>) => boolean), f: Fn<S>]
  ) => {
    const f = r[r.length - 1] as (a: never, c: C) => Promise<unknown>;
    const dg = r.length === 2 ? r[0] : undefined;
    defs.push({
      name,
      description,
      shape,
      write,
      danger: typeof dg === 'string' ? dg : undefined,
      dangerIf: typeof dg === 'function' ? (dg as (a: never) => boolean) : undefined,
      run: (a, uid, tokenId) => f(a, { uid, tokenId }),
    });
  };
  def(
    'list_spaces',
    'Пространства пользователя',
    {},
    false,
    async (_, c) => (await rest.spaces(c.uid, { limit: 200 })).data,
  );
  def(
    'list_projects',
    'Проекты (можно по пространству)',
    { spaceId: z.uuid().optional() },
    false,
    async (a, c) => (await rest.projects(c.uid, { limit: 200, ...a })).data,
  );
  const filters = {
    projectId: z.uuid().optional(),
    statusId: z.uuid().optional(),
    statusCategory: z
      .enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled'])
      .optional()
      .describe('категория статуса — без знания id статусов проекта'),
    limit: z.number().int().min(1).max(200).optional(),
  };
  // tasks with the status name and category: statusId alone tells an agent nothing
  const named = async <T extends { statusId?: unknown; description?: unknown }>(ts: T[]) => {
    const st = await rest.statusInfo(ts.map((t) => String(t.statusId)));
    return ts.map((t) => ({ ...flat(t), status: st.get(String(t.statusId)) ?? null }));
  };
  def(
    'list_fields',
    'Определения пользовательских полей проекта',
    { projectId: z.uuid() },
    false,
    async (a, c) => (await rest.fields(c.uid, a.projectId)).data,
  );
  def(
    'project_dictionary',
    'Статусы (название, категория), метки и участники проекта — расшифровка statusId, labelIds, assigneeIds',
    { projectId: z.uuid() },
    false,
    async (a, c) => rest.dictionary(c.uid, a.projectId),
  );
  def(
    'search_tasks',
    'Поиск задач по части заголовка или ключа',
    {
      query: z.string().optional(),
      assigneeId: z.union([z.uuid(), z.literal('me')]).optional(),
      ...filters,
    },
    false,
    async (a, c) => named(await rest.searchTasks(c.uid, a)),
  );
  def('get_task', 'Задача с комментариями и связями', { task }, false, async (a, c) => {
    const t = (await rest.task(c.uid, a.task)).data;
    const comments = (await rest.comments(c.uid, a.task, { limit: 200 })).data;
    const links = (await rest.links(c.uid, a.task)).data;
    return { ...(await named([t]))[0], comments: comments.map(cmt), links };
  });
  def(
    'my_tasks',
    'Задачи, назначенные мне или с назначенным мне открытым комментарием / пунктом чек-листа (по умолчанию без done/cancelled)',
    { includeDone: z.boolean().optional(), ...filters },
    false,
    async (a, c) =>
      named(
        await rest.searchTasks(c.uid, {
          ...a,
          assigneeId: 'me',
          includeDone: a.includeDone ?? false,
        }),
      ),
  );
  def(
    'create_task',
    'Создать задачу',
    createTaskBody.shape,
    true,
    async (a, c) => (await named([(await rest.createTask(c.uid, a, c.tokenId)).data]))[0],
  );
  def(
    'update_task',
    'Изменить задачу',
    { task, ...patchTaskBody.shape },
    true,
    (a: { description?: unknown }) => a.description !== undefined,
    async ({ task: ref, ...a }, c) =>
      (await named([(await rest.patchTask(c.uid, ref, a, c.tokenId)).data]))[0],
  );
  def(
    'add_comment',
    'Добавить комментарий (@login — упоминание); parentId — ответ в тред, assigneeId — назначить',
    { task, ...commentBody.shape },
    true,
    async ({ task: ref, ...a }, c) =>
      cmt((await rest.createComment(c.uid, ref, a, c.tokenId)).data),
  );
  def(
    'update_comment',
    'Изменить комментарий: assigneeId — назначить (null — снять), resolved — выполнен / переоткрыть, text — новый текст (только автор)',
    { id: z.uuid().describe('id комментария'), ...patchCommentBody.shape },
    true,
    async ({ id, ...a }, c) => cmt((await rest.patchComment(c.uid, id, a, c.tokenId)).data),
  );
  def(
    'link_tasks',
    'Связать две задачи (blocks, relates, duplicates)',
    { task, ...linkBody.shape },
    true,
    async ({ task: ref, ...a }, c) => (await rest.createLink(c.uid, ref, a, c.tokenId)).data,
  );
  def(
    'unlink_tasks',
    'Удалить связь задач (id связи — из get_task links)',
    { id: z.uuid().describe('id связи') },
    true,
    'delete',
    async (a, c) => {
      await rest.deleteLink(c.uid, a.id, c.tokenId);
      return { ok: true };
    },
  );
  def(
    'list_time_entries',
    'Записи времени: по задаче, пользователю (me), периоду; страницы через cursor',
    timeEntriesQuery.shape,
    false,
    async (a, c) => rest.timeEntries(c.uid, a),
  );
  def(
    'get_timer',
    'Идущий таймер (null, если его нет)',
    {},
    false,
    async (_, c) => (await rest.timer(c.uid)).data,
  );
  def(
    'log_time',
    'Записать время на задачу (минуты); начало — 09:00 UTC даты, по умолчанию сегодня',
    {
      task,
      minutes: z.number().int().min(1).max(1440),
      date: z.iso.date().optional(),
      note: z.string().max(1000).optional(),
    },
    true,
    async (a, c) =>
      (
        await rest.logTime(
          c.uid,
          {
            task: a.task,
            startedAt: `${a.date ?? new Date().toISOString().slice(0, 10)}T09:00:00.000Z`,
            durationSec: a.minutes * 60,
            note: a.note,
          },
          c.tokenId,
        )
      ).data,
  );
  def(
    'start_timer',
    'Запустить таймер на задаче (прежний останавливается)',
    { task },
    true,
    async (a, c) => (await rest.startTimer(c.uid, a, c.tokenId)).data,
  );
  def(
    'stop_timer',
    'Остановить идущий таймер (null, если его нет)',
    {},
    true,
    async (_, c) => (await rest.stopTimer(c.uid, c.tokenId)).data,
  );
  def(
    'current_sprint',
    'Текущий цикл проекта и его задачи (null, если нет)',
    { projectId: z.uuid() },
    false,
    async (a, c) => {
      const cycle = (await rest.currentCycle(c.uid, a.projectId)).data;
      if (!cycle) return null;
      const tasks = await rest.cycleTasks(c.uid, cycle.id as string);
      return {
        cycle,
        tasks: tasks.map((t) => ({
          key: t.key,
          title: t.title,
          statusId: t.statusId,
          priority: t.priority,
          dueDate: t.dueDate,
          assigneeIds: t.assigneeIds,
        })),
      };
    },
  );
  def(
    'list_sprints',
    'Циклы (спринты) проекта',
    { projectId: z.uuid() },
    false,
    async (a, c) => (await rest.cycles(c.uid, a.projectId)).data,
  );
  def(
    'list_automations',
    'Правила автоматизаций проекта',
    { projectId: z.uuid() },
    false,
    async (a, c) => (await rest.automations(c.uid, a.projectId)).data,
  );
  // documents (docs module, PLNRAPP-180)
  const doc = z.uuid().describe('id документа');
  def(
    'list_docs',
    'Документы проекта (без содержимого): дерево по parentId',
    docsQuery.shape,
    false,
    async (a, c) => (await rest.docs(c.uid, a)).data,
  );
  def(
    'get_doc',
    'Документ: содержимое в markdown и связанные задачи; section — только один раздел большого документа',
    { id: doc, ...docQuery.shape },
    false,
    async ({ id, ...a }, c) => (await rest.doc(c.uid, id, a)).data,
  );
  def(
    'create_doc',
    'Создать документ в проекте; содержимое — markdown',
    createDocBody.shape,
    true,
    async (a, c) => (await rest.createDoc(c.uid, a, c.tokenId)).data,
  );
  def(
    'update_doc',
    'Изменить документ: title; markdown — заменить содержимое целиком, append — дописать в конец, replace {find, replace} — точечная правка фрагмента (для правок предпочтительнее markdown)',
    { id: doc, ...patchDocBody.shape },
    true,
    (a: { markdown?: unknown; append?: unknown; replace?: unknown }) =>
      a.markdown !== undefined || a.append !== undefined || a.replace !== undefined,
    async ({ id, ...a }, c) => (await rest.updateDoc(c.uid, id, a, c.tokenId)).data,
  );
  def(
    'link_doc_task',
    'Связать документ с задачей',
    { pageId: doc, ...docTaskBody.shape },
    true,
    async ({ pageId, ...a }, c) => (await rest.linkDocTask(c.uid, pageId, a, c.tokenId)).data,
  );
  return defs;
}

type Fn<S extends z.ZodRawShape> = (a: z.infer<z.ZodObject<S>>, c: C) => Promise<unknown>;

/** New server per request (stateless); rights — from the token ctx. */
export function buildMcpServer(rest: RestService, ctx: AuthCtx): McpServer {
  const server = new McpServer({ name: 'planar', version: '1.0.0' });
  for (const d of toolDefs(rest))
    server.registerTool(d.name, { description: d.description, inputSchema: d.shape }, (async (
      a: never,
    ) => {
      if (d.write && ctx.tokenScope === 'read') return fail('forbidden', 'Токен только для чтения');
      try {
        return out(await d.run(a, ctx.userId, ctx.tokenId));
      } catch (e) {
        if (e instanceof HttpError) return fail(e.code, e.message);
        throw e;
      }
    }) as never);
  return server;
}
