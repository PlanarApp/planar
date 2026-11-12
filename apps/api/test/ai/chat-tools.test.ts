// AIC-1: the tool registry as AI SDK tools — calls go as the initiator, refusals are results, danger needs confirmation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { chatTools, CHAT_BULK_LIMIT } from '../../../../modules/ai/api/chat-tools.js';
import * as schema from '../../src/db/schema.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { PushQueue } from '../../src/push/push.js';
import { RestService } from '../../src/rest/rest.service.js';
import { PushService } from '../../src/sync/push.service.js';
import {
  dbUrl,
  newDb,
  services,
  taskArgs,
  TestClient,
  world,
  type World,
} from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
const jobs: { queue: string; data: Record<string, unknown> }[] = [];
let w: World;
let rest: RestService;

beforeAll(async () => {
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['automations'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['automations'] } });
  w = await world(db);
  const svc = { ...services(db), push: new PushService(db, queue) };
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    w[c] = new TestClient(svc, w[c].userId);
  queue.jobs.enqueue = async (q, data) => void jobs.push({ queue: q, data: data as never });
  rest = new RestService(db, queue);
});
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const call = (t: ReturnType<typeof chatTools>, name: string, args: object) =>
  (t[name]!.execute as (a: object, o: object) => Promise<unknown>)(args, {
    toolCallId: 'c',
    messages: [],
  });
const mk = async () => {
  const a = taskArgs(w, { title: 'Секрет' });
  await w.admin.ok('task.create', a);
  return a.id;
};

describe('chat-tools', () => {
  it('вызывает от initiator: участник видит задачу, посторонний получает отказ без данных', async () => {
    const id = await mk();
    const mine = await call(chatTools(toolDefs(rest), w.member.userId), 'get_task', { task: id });
    expect(mine).toMatchObject({ title: 'Секрет' });
    const other = await call(chatTools(toolDefs(rest), w.outsider.userId), 'get_task', {
      task: id,
    });
    expect(other).toMatchObject({ error: expect.stringMatching(/not_found|forbidden/) });
    expect(JSON.stringify(other)).not.toContain('Секрет');
  });

  it('write-инструмент без права: ошибка результатом, данные не меняются', async () => {
    const id = await mk();
    const r = await call(chatTools(toolDefs(rest), w.outsider.userId), 'update_task', {
      task: id,
      title: 'Взлом',
    });
    expect(r).toHaveProperty('error');
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    expect(t!.title).toBe('Секрет');
  });

  it('опасный инструмент не исполняется: needsConfirmation', async () => {
    const a = await mk();
    const b = await mk();
    const linkId = uuidv7();
    await w.admin.ok('link.create', { id: linkId, taskId: a, targetId: b, kind: 'relates' });
    const r = await call(chatTools(toolDefs(rest), w.admin.userId), 'unlink_tasks', { id: linkId });
    expect(r).toMatchObject({ needsConfirmation: true });
    expect(
      await db.select().from(schema.taskLinks).where(eq(schema.taskLinks.id, linkId)),
    ).toHaveLength(1);
    expect(CHAT_BULK_LIMIT).toBe(5);
  });

  it('origin.aiRunId доходит до хуков модулей (правило автоматизации получает aiRunId)', async () => {
    const ruleId = uuidv7();
    await w.admin.ok('automations.create', {
      id: ruleId,
      projectId: w.projectId,
      name: 'R',
      trigger: { type: 'comment.added' },
      actions: [{ type: 'set_status', statusId: w.statusIds[2] }],
    });
    const id = await mk();
    const aiRunId = uuidv7();
    const t = chatTools(toolDefs(rest.withOrigin({ aiRunId, depth: 0 })), w.member.userId);
    jobs.length = 0;
    const r = await call(t, 'add_comment', { task: id, text: 'из чата' });
    expect(r).not.toHaveProperty('error');
    expect(jobs.filter((j) => j.data.ruleId === ruleId).map((j) => j.data.aiRunId)).toEqual([
      aiRunId,
    ]);
  });
});
