import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/chat.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, workspaceModule, world, type World } from '../sync/helpers.js';

// PLNRAPP-278 (CH-1): chat channels, dialogs and messages over REST v1 and MCP, as the user
const PARITY_CHAT: Record<string, string> = {
  'GET /api/v1/chat/channels': 'list_chat_channels',
  'POST /api/v1/spaces/{id}/chat/channels': 'create_chat_channel',
  'POST /api/v1/chat/dms': 'create_chat_dm',
  'GET /api/v1/chat/channels/{id}/members': 'list_chat_members',
  'POST /api/v1/chat/dms/{id}/members': 'add_chat_member',
  'DELETE /api/v1/chat/dms/{id}/members/{userId}': 'remove_chat_member',
  'DELETE /api/v1/chat/dms/{id}/membership': 'leave_chat_dm',
  'PUT /api/v1/chat/channels/{id}/mute': 'mute_chat',
  'POST /api/v1/chat/channels/{id}/read': 'mark_chat_read',
  'GET /api/v1/chat/channels/{id}/messages': 'list_chat_messages',
  'GET /api/v1/chat/messages/{id}/thread': 'get_chat_thread',
  'POST /api/v1/chat/channels/{id}/messages': 'send_chat_message',
  'PATCH /api/v1/chat/messages/{id}': 'edit_chat_message',
  'DELETE /api/v1/chat/messages/{id}': 'delete_chat_message',
  'PUT /api/v1/chat/messages/{id}/reactions': 'toggle_chat_reaction',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let admin: string;
let member: string;
let read: string;
let outsider: string;

async function issue(userId: string, scope: 'read' | 'write') {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: await loginCookie(db, userId), origin: ORIGIN },
      payload: { name: 't', scope },
    });
  return apiTokenCreatedSchema.parse(r.json()).secret;
}

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  w = await world(db);
  await workspaceModule(db, 'chat');
  admin = await issue(w.admin.userId, 'write');
  member = await issue(w.member.userId, 'write');
  read = await issue(w.admin.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
});
afterAll(async () => {
  kids.forEach((k) => k.kill());
  await app.close();
  await db.$client.end();
});

const kids: ReturnType<typeof spawn>[] = [];
async function mcp(secret: string) {
  const p = spawn(
    process.execPath,
    [new URL('./bridge.mjs', import.meta.url).pathname, `${base}/mcp`, secret],
    { cwd: new URL('../..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  kids.push(p);
  const lines = createInterface({ input: p.stdout! })[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await lines.next()).value as string);
  await next();
  let id = 0;
  return async (name: string, args: Record<string, unknown> = {}) => {
    p.stdin!.write(
      JSON.stringify({ id: ++id, method: 'callTool', params: { name, arguments: args } }) + '\n',
    );
    const r = await next();
    if (r.error) throw new Error(r.error);
    const res = r.result as { isError?: boolean; content: { text: string }[] };
    return [!!res.isError, JSON.parse(res.content[0]!.text)] as const;
  };
}

const rest = async (secret: string, method: string, url: string, payload?: object) => {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
  return [r.statusCode, r.body ? r.json() : null] as const;
};

describe('чат (ext/chat)', () => {
  it('PARITY_CHAT равен операциям области; удаления — danger delete, чтение — без write', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_CHAT);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops.filter((x) => x.method === 'delete'))
      expect(defs.find((d) => d.name === o.tool)?.danger, o.tool).toBe('delete');
    for (const t of [
      'list_chat_channels',
      'list_chat_members',
      'list_chat_messages',
      'get_chat_thread',
    ])
      expect(defs.find((d) => d.name === t)?.write, t).toBe(false);
  });

  it('канал: создать → сообщение → тред → правка → реакция → прочитано → mute → удаление', async () => {
    const call = await mcp(admin);
    const [e0, ch] = await call('create_chat_channel', { id: w.spaceId, name: 'Общий' });
    expect([e0, ch.name], JSON.stringify(ch)).toEqual([false, 'Общий']);
    const [e1, m1] = await call('send_chat_message', { id: ch.id, text: 'Привет\nмир' });
    expect([e1, m1.seq], JSON.stringify(m1)).toEqual([false, 1]);
    const [e2, rep] = await call('send_chat_message', {
      id: ch.id,
      text: 'ответ',
      parentId: m1.id,
    });
    expect([e2, rep.parentId], JSON.stringify(rep)).toEqual([false, m1.id]);
    const [, hist] = await call('list_chat_messages', { id: ch.id });
    expect(hist.messages.map((m: { id: string }) => m.id)).toEqual([m1.id]);
    const [, th] = await call('get_chat_thread', { id: m1.id });
    expect([th.root.replyCount, th.replies.length]).toEqual([1, 1]);
    expect(
      (await call('edit_chat_message', { id: m1.id, text: 'Правка' }))[1].editedAt,
    ).toBeTruthy();
    const [e3, rx] = await call('toggle_chat_reaction', { id: m1.id, emoji: '👍' });
    expect([e3, rx.length], JSON.stringify(rx)).toEqual([false, 1]);
    expect((await call('toggle_chat_reaction', { id: m1.id, emoji: '👍' }))[1]).toEqual([]);
    expect((await call('mark_chat_read', { id: ch.id }))[1].lastReadSeq).toBe(1);
    expect((await call('mute_chat', { id: ch.id, muted: true }))[1].muted).toBe(true);
    const [, list] = await call('list_chat_channels', { spaceId: w.spaceId });
    const mine = list.find((c: { id: string }) => c.id === ch.id);
    expect([mine.muted, mine.lastReadSeq]).toEqual([true, 1]);
    expect((await call('list_chat_members', { id: ch.id }))[1].length).toBeGreaterThanOrEqual(3);
    const [, viaRest] = await rest(admin, 'GET', `/chat/channels/${ch.id}/messages?limit=5`);
    expect(viaRest.data.messages).toHaveLength(1);
    expect((await call('delete_chat_message', { id: rep.id }))[0]).toBe(false);
    expect((await call('delete_chat_message', { id: m1.id }))[0]).toBe(false);
    expect((await call('edit_chat_message', { id: m1.id, text: 'x' }))[1].code).toBe('conflict');
  });

  it('личный чат: создать → участники → сообщение → выйти', async () => {
    const adm = await mcp(admin);
    const mem = await mcp(member);
    const [e0, dm] = await adm('create_chat_dm', { userIds: [w.member.userId] });
    expect([e0, dm.kind], JSON.stringify(dm)).toEqual([false, 'dm']);
    expect((await adm('list_chat_members', { id: dm.id }))[1]).toHaveLength(2);
    expect((await mem('send_chat_message', { id: dm.id, text: 'hi' }))[0]).toBe(false);
    const [, msgs] = await adm('list_chat_messages', { id: dm.id });
    expect(msgs.messages).toHaveLength(1);
    const [e1, nm] = await mem('edit_chat_message', { id: msgs.messages[0].id, text: 'x' });
    expect([e1, nm.body.content[0].content[0].text]).toEqual([false, 'x']);
    expect((await adm('edit_chat_message', { id: msgs.messages[0].id, text: 'y' }))[1].code).toBe(
      'forbidden',
    );
    expect((await adm('leave_chat_dm', { id: dm.id }))[0]).toBe(false);
    expect((await adm('list_chat_messages', { id: dm.id }))[1].code).toBe('not_found');
  });

  it('отказы: чужой — not_found, токен read — forbidden', async () => {
    const adm = await mcp(admin);
    const [, ch] = await adm('create_chat_channel', { id: w.spaceId, name: 'Закрытый' });
    const [, m] = await adm('send_chat_message', { id: ch.id, text: 'секрет' });
    const [, dm] = await adm('create_chat_dm', { userIds: [w.member.userId] });
    const out = await mcp(outsider);
    for (const [tool, args] of [
      ['create_chat_channel', { id: w.spaceId, name: 'x' }],
      ['list_chat_members', { id: ch.id }],
      ['list_chat_members', { id: dm.id }],
      ['add_chat_member', { id: dm.id, userId: w.outsider.userId }],
      ['remove_chat_member', { id: dm.id, userId: w.member.userId }],
      ['leave_chat_dm', { id: dm.id }],
      ['mute_chat', { id: ch.id, muted: true }],
      ['mark_chat_read', { id: ch.id }],
      ['list_chat_messages', { id: ch.id }],
      ['list_chat_messages', { id: dm.id }],
      ['get_chat_thread', { id: m.id }],
      ['send_chat_message', { id: ch.id, text: 'x' }],
      ['edit_chat_message', { id: m.id, text: 'x' }],
      ['delete_chat_message', { id: m.id }],
      ['toggle_chat_reaction', { id: m.id, emoji: '👍' }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    const [, outList] = await out('list_chat_channels');
    expect(outList.some((c: { id: string }) => [ch.id, dm.id].includes(c.id))).toBe(false);
    const ro = await mcp(read);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, {
        id: ch.id,
        userIds: [w.member.userId],
        userId: w.member.userId,
        text: 'x',
        name: 'x',
        muted: true,
        emoji: 'x',
      });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await rest(outsider, 'GET', `/chat/channels/${ch.id}/messages`))[0]).toBe(404);
    expect((await rest(read, 'POST', `/chat/channels/${ch.id}/messages`, { text: 'x' }))[0]).toBe(
      403,
    );
  });
});
