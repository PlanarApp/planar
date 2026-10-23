import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HttpErrorCode } from '@planar/shared';
import type { AuthCtx } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import type { RestService } from '../rest/rest.service.js';
import { commentBody, createTaskBody, patchTaskBody } from '../rest/schemas.js';

type Node = { text?: string; attrs?: { label?: string }; type?: string; content?: Node[] };
/** ProseMirror-документ → простой текст (абзацы через \n, mention → @login) */
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

/** Новый сервер на каждый запрос (stateless); права — из ctx токена. */
export function buildMcpServer(rest: RestService, ctx: AuthCtx): McpServer {
  const server = new McpServer({ name: 'planar', version: '1.0.0' });
  const uid = ctx.userId;
  const run = (write: boolean, f: (a: never) => Promise<unknown>) => async (a: never) => {
    if (write && ctx.tokenScope === 'read') return fail('forbidden', 'Токен только для чтения');
    try {
      return out(await f(a));
    } catch (e) {
      if (e instanceof HttpError) return fail(e.code, e.message);
      throw e;
    }
  };
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    write: boolean,
    f: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) => server.registerTool(name, { description, inputSchema }, run(write, f as never) as never);

  tool(
    'list_spaces',
    'Пространства пользователя',
    {},
    false,
    async () => (await rest.spaces(uid, { limit: 200 })).data,
  );
  tool(
    'list_projects',
    'Проекты (можно по пространству)',
    { spaceId: z.uuid().optional() },
    false,
    async (a) => (await rest.projects(uid, { limit: 200, ...a })).data,
  );
  const filters = {
    projectId: z.uuid().optional(),
    statusId: z.uuid().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  };
  tool(
    'search_tasks',
    'Поиск задач по части заголовка или ключа',
    {
      query: z.string().optional(),
      assigneeId: z.union([z.uuid(), z.literal('me')]).optional(),
      ...filters,
    },
    false,
    async (a) => (await rest.searchTasks(uid, a)).map(flat),
  );
  tool('get_task', 'Задача с комментариями', { task }, false, async (a) => {
    const t = (await rest.task(uid, a.task)).data;
    const comments = (await rest.comments(uid, a.task, { limit: 200 })).data;
    return { ...flat(t), comments: comments.map(cmt) };
  });
  tool(
    'my_tasks',
    'Задачи, назначенные мне (по умолчанию без done/cancelled)',
    { includeDone: z.boolean().optional(), ...filters },
    false,
    async (a) =>
      (
        await rest.searchTasks(uid, { ...a, assigneeId: 'me', includeDone: a.includeDone ?? false })
      ).map(flat),
  );
  tool('create_task', 'Создать задачу', createTaskBody.shape, true, async (a) =>
    flat((await rest.createTask(uid, a, ctx.tokenId)).data),
  );
  tool(
    'update_task',
    'Изменить задачу',
    { task, ...patchTaskBody.shape },
    true,
    async ({ task: ref, ...a }) => flat((await rest.patchTask(uid, ref, a, ctx.tokenId)).data),
  );
  tool(
    'add_comment',
    'Добавить комментарий (@login — упоминание)',
    { task, ...commentBody.shape },
    true,
    async ({ task: ref, ...a }) => cmt((await rest.createComment(uid, ref, a, ctx.tokenId)).data),
  );
  return server;
}
