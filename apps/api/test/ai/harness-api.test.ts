// PLNRAPP-169 (AIH-2): harness API — diff and apply of a pack stored in the project docs.
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { parseInstructionPage } from '@planar/module-ai/api';
import { loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { key, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
const cookies: Record<string, string> = {};
let P: string;
let root: string;
let bot: string;

const raw = async (text: string, values: unknown[] = []) =>
  (await db.$client.query(text, values)).rows as Record<string, ReturnType<typeof JSON.parse>>[];
type Op = { kind: string; op: string; key: string };
const post = (path: 'diff' | 'apply', who: string, body: object) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: `/api/ai/harness/${path}`,
      payload: body,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const paragraph = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const row = (k: string, v: string) => ({
  type: 'tableRow',
  content: [k, v].map((t) => ({ type: 'tableCell', content: [paragraph(t)] })),
});
const code = (t: string) => ({
  type: 'codeBlock',
  attrs: { language: 'yaml harness.yml' },
  content: [{ type: 'text', text: t }],
});
const instruction = {
  type: 'doc',
  content: [
    paragraph('Составляет план'),
    {
      type: 'table',
      content: [row('runtime', 'llm'), row('checks', 'план конечен\nесть оценка')],
    },
    paragraph('Составь план задачи.'),
  ],
};

const YML = `
statuses:
  - {key: backlog, name: Бэклог, category: backlog}
  - {key: clarify, name: Уточнение, category: todo, color: '#fa0'}
  - {key: stale, name: Старый, category: todo}
labels: [{key: has_plan, name: Есть план}]
fields: [{key: amount, name: Сумма, type: number}]
actions: [plan]
rules:
  - name: План в бэклоге
    trigger: {type: task.status_changed, to: [backlog]}
    filter: {assignee: [ai]}
    actions: [{type: ai_run, action: plan}]
  - name: Выключенное
    enabled: false
    trigger: {type: task.created}
    actions: [{type: ai_run, action: plan}]
settings: {questionStatus: clarify}
`;
const YML2 = `
statuses:
  - {key: backlog, name: Бэклог 2, category: backlog}
  - {key: clarify, name: Уточнение, category: todo}
labels: []
fields: [{key: amount, name: Сумма итого, type: number}]
actions: [plan]
rules:
  - name: План в бэклоге
    trigger: {type: task.status_changed, to: [backlog]}
    filter: {assignee: [ai]}
    actions: [{type: ai_run, action: plan}]
settings: {questionStatus: clarify}
`;

const page = async (title: string, body: object, parentId?: string) => {
  const id = uuidv7();
  await w.admin.ok('docs.page.create', {
    id,
    spaceId: w.spaceId,
    projectId: P,
    parentId,
    rank: `a${title.length}`,
    title,
    body,
  });
  return id;
};
const setYml = (yml: string) =>
  raw(`update docs_pages set body = $1 where id = $2`, [
    JSON.stringify({ type: 'doc', content: [code(yml)] }),
    root,
  ]);
const req = () => ({ projectId: P, packPageId: root });
const names = async (table: string) =>
  (await raw(`select name from ${table} where project_id = $1 order by name`, [P])).map(
    (r) => r.name as string,
  );

beforeAll(async () => {
  w = await world(db);
  cookies.admin = await loginCookie(db, w.admin.userId);
  cookies.member = await loginCookie(db, w.member.userId);
  P = uuidv7();
  await w.admin.ok('project.create', {
    id: P,
    spaceId: w.spaceId,
    name: 'H',
    key: key(),
    rank: 'a0',
  });
  bot = (await raw(`select id from users where login = 'ai' and bot`))[0]!.id;
  root = await page('Продажи', { type: 'doc', content: [code(YML)] });
  await page('plan', instruction, root);
});

describe('harness api', () => {
  it('diff ничего не меняет и показывает создание всего', async () => {
    const before = await names('statuses');
    const r = await post('diff', 'admin', req());
    expect(r.statusCode).toBe(200);
    const { ops, errors } = r.json();
    expect(errors).toEqual([]);
    expect(ops.filter((o: Op) => o.op === 'create').map((o: Op) => o.kind + o.key)).toEqual([
      'statusbacklog',
      'statusclarify',
      'statusstale',
      'labelhas_plan',
      'fieldamount',
      'actionplan',
      'ruleПлан в бэклоге',
      'ruleВыключенное',
    ]);
    expect(ops.at(-1)).toMatchObject({ kind: 'rule', op: 'enable', key: 'План в бэклоге' });
    expect(await names('statuses')).toEqual(before);
  });

  it('не админ проекта — 403, пакет не из проекта — 404', async () => {
    expect((await post('diff', 'member', req())).statusCode).toBe(403);
    expect((await post('apply', 'member', req())).statusCode).toBe(403);
    expect((await post('diff', 'admin', { ...req(), packPageId: uuidv7() })).statusCode).toBe(404);
  });

  it('apply: всё создано, цвет и rank по умолчанию, действие смотрит на страницу, правила включены в конце', async () => {
    const r = await post('apply', 'admin', req());
    expect(r.statusCode).toBe(200);
    const st = await raw(
      `select * from statuses where project_id = $1 and name in ('Бэклог', 'Уточнение')`,
      [P],
    );
    const backlog = st.find((s) => s.name === 'Бэклог')!;
    expect(backlog.color).toBeTruthy();
    expect(st.find((s) => s.name === 'Уточнение')!.color).toBe('#fa0');
    expect(backlog.rank).toBeTruthy();
    expect(await names('labels')).toContain('Есть план');
    expect(await names('field_defs')).toContain('Сумма');
    const child = (await raw(`select id from docs_pages where parent_id = $1`, [root]))[0]!.id;
    const [act] = await raw(`select * from ai_actions where project_id = $1 and key = 'plan'`, [P]);
    expect(act).toMatchObject({
      name: 'plan',
      description: 'Составляет план',
      runtime: 'llm',
      page_id: child,
      checks: ['план конечен', 'есть оценка'],
    });
    expect(act.question_status_id).toBe(st.find((s) => s.name === 'Уточнение')!.id);
    const rules = await raw(`select * from automations_rules where project_id = $1 order by name`, [
      P,
    ]);
    expect(rules.map((x) => [x.name, x.enabled])).toEqual([
      ['Выключенное', false],
      ['План в бэклоге', true],
    ]);
    const on = rules.find((x) => x.name === 'План в бэклоге')!;
    expect(on.trigger.to).toEqual([backlog.id]);
    expect(on.conditions.rules[0]).toMatchObject({ field: 'assignee', value: [bot] });
    expect(on.actions[0]).toEqual({ type: 'ai_run', aiActionId: act.id });
    const keys = await raw(`select kind, key from ai_harness_keys where project_id = $1`, [P]);
    expect(keys).toHaveLength(8);
  });

  it('повторный apply ничего не дублирует', async () => {
    expect((await post('apply', 'admin', req())).statusCode).toBe(200);
    expect(await names('statuses')).toHaveLength(8);
    expect(await names('automations_rules')).toHaveLength(2);
    expect(await names('ai_actions')).toHaveLength(1);
  });

  it('удаление статуса с задачами: без replaceWith — 400, с ним задачи переезжают; update и delete остальных', async () => {
    const stale = (
      await raw(`select id from statuses where project_id = $1 and name = 'Старый'`, [P])
    )[0]!.id;
    const t = uuidv7();
    await w.admin.ok('task.create', {
      id: t,
      projectId: P,
      statusId: stale,
      title: 'T',
      rank: 'a0',
    });
    await setYml(YML2);
    const bad = await post('apply', 'admin', req());
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error?.message ?? bad.body).toContain('replaceWith');
    expect(await names('labels')).toContain('Есть план');
    const d = await post('diff', 'admin', { ...req(), replaceWith: { stale: 'backlog' } });
    expect(d.json().errors).toEqual([]);
    expect(d.json().ops.find((o: Op) => o.op === 'delete' && o.key === 'stale')).toMatchObject({
      replaceWith: 'backlog',
    });
    expect(
      (await post('apply', 'admin', { ...req(), replaceWith: { stale: 'backlog' } })).statusCode,
    ).toBe(200);
    const backlog = (
      await raw(`select id from statuses where project_id = $1 and name = 'Бэклог 2'`, [P])
    )[0]!.id;
    expect((await raw(`select status_id from tasks where id = $1`, [t]))[0]!.status_id).toBe(
      backlog,
    );
    expect(await names('statuses')).not.toContain('Старый');
    expect(await names('labels')).toEqual([]);
    expect(await names('field_defs')).toContain('Сумма итого');
    expect(await names('automations_rules')).toEqual(['План в бэклоге']);
    const keys = await raw(`select kind, key from ai_harness_keys where project_id = $1`, [P]);
    expect(keys).toHaveLength(5);
  });

  it('replaceWith на статус, создаваемый в том же пакете: задачи переезжают в новый', async () => {
    const withStatus = (k: string, name: string) =>
      YML2.replace('labels: []', `  - {key: ${k}, name: ${name}, category: todo}\nlabels: []`);
    await setYml(withStatus('old', 'Прежний'));
    expect((await post('apply', 'admin', req())).statusCode).toBe(200);
    const oldId = (
      await raw(`select id from statuses where project_id = $1 and name = 'Прежний'`, [P])
    )[0]!.id;
    const t = uuidv7();
    await w.admin.ok('task.create', {
      id: t,
      projectId: P,
      statusId: oldId,
      title: 'T2',
      rank: 'a1',
    });
    await setYml(withStatus('fresh', 'Свежий'));
    const body = { ...req(), replaceWith: { old: 'fresh' } };
    const d = (await post('diff', 'admin', body)).json();
    expect(d.errors).toEqual([]);
    expect(d.ops.find((o: Op) => o.op === 'delete' && o.key === 'old')).toMatchObject({
      replaceWith: 'fresh',
    });
    expect((await post('apply', 'admin', body)).statusCode).toBe(200);
    const [fresh] = await raw(`select id from statuses where project_id = $1 and name = 'Свежий'`, [
      P,
    ]);
    expect(fresh).toBeTruthy();
    expect((await raw(`select status_id from tasks where id = $1`, [t]))[0]!.status_id).toBe(
      fresh!.id,
    );
    expect(await names('statuses')).not.toContain('Прежний');
    const keys = await raw(
      `select key, entity_id from ai_harness_keys where project_id = $1 and kind = 'status'`,
      [P],
    );
    expect(keys.find((k) => k.key === 'fresh')!.entity_id).toBe(fresh!.id);
    expect(keys.some((k) => k.key === 'old')).toBe(false);
  });

  it('ошибка в пакете — 400 без изменений', async () => {
    await setYml('statuses: [{key: Плохой}]');
    const r = await post('apply', 'admin', req());
    expect(r.statusCode).toBe(400);
    await setYml(YML2);
  });
});

describe('harness: страница инструкции', () => {
  it('промпт — часть после таблицы параметров; без таблицы вся страница', () => {
    const p = parseInstructionPage('plan', instruction);
    expect(p).toMatchObject({ structured: true, key: 'plan' });
    expect(p.instruction.prompt).toBe('Составь план задачи.');
    const bare = parseInstructionPage('x', { type: 'doc', content: [paragraph('Только промпт')] });
    expect(bare.structured).toBe(false);
    expect(bare.instruction.prompt).toBe('Только промпт');
  });
});
