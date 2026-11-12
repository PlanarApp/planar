// AIX-3: apply в непустом проекте (привязка по имени/ключу), checks, questionStatus, активный пакет
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { parseInstructionPage } from '@planar/module-ai/api';
import { computeDiff, parseHarnessYaml } from '@planar/module-ai/shared';
import { loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { key, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
let cookie: string;
let P: string;
let root: string;

const raw = async (text: string, values: unknown[] = []) =>
  (await db.$client.query(text, values)).rows as Record<string, ReturnType<typeof JSON.parse>>[];
const post = (path: 'diff' | 'apply') =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: `/api/ai/harness/${path}`,
      payload: { projectId: P, packPageId: root },
      headers: { cookie, origin: ORIGIN },
    });
const paragraph = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const row = (k: string, v: string) => ({
  type: 'tableRow',
  content: [k, v].map((t) => ({ type: 'tableCell', content: [paragraph(t)] })),
});
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

const YML = `
statuses:
  - {key: backlog, name: Backlog, category: backlog}
  - {key: clarify, name: Уточнение, category: todo}
actions: [plan]
settings: {questionStatus: clarify}
`;

beforeAll(async () => {
  w = await world(db);
  cookie = await loginCookie(db, w.admin.userId);
  P = uuidv7();
  await w.admin.ok('project.create', {
    id: P,
    spaceId: w.spaceId,
    name: 'F',
    key: key(),
    rank: 'a0',
  });
  root = await page('Пакет', {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language: 'yaml harness.yml' },
        content: [{ type: 'text', text: YML }],
      },
    ],
  });
  await page(
    'plan',
    {
      type: 'doc',
      content: [
        { type: 'table', content: [row('checks', 'первое'), row('checks', 'второе')] },
        paragraph('Промпт'),
      ],
    },
    root,
  );
});

describe('harness: исправления AIX-3', () => {
  it('checks: строка на критерий, не только последняя', () => {
    const body = {
      type: 'doc',
      content: [{ type: 'table', content: [row('checks', 'а'), row('checks', 'б')] }],
    };
    expect(parseInstructionPage('x', body).instruction.checks).toEqual(['а', 'б']);
  });

  it('apply в проекте со своим статусом и ручным действием: update, без дублей и 500', async () => {
    const st = (await raw(`select id, name from statuses where project_id = $1`, [P])).map(
      (s) => s.name as string,
    );
    // статус в другом регистре и действие без ключа пакета
    await w.admin.ok('status.create', {
      id: uuidv7(),
      projectId: P,
      name: 'BACKLOG',
      category: 'backlog',
      color: '#94a3b8',
      rank: 'a5',
    });
    await w.admin.ok('ai.action.create', {
      id: uuidv7(),
      projectId: P,
      key: 'plan',
      name: 'ручное',
      runtime: 'llm',
      checks: [],
    });
    const r = await post('apply');
    expect(r.statusCode).toBe(200);
    const after = await raw(`select name from statuses where project_id = $1`, [P]);
    expect(after.filter((s) => String(s.name).toLowerCase() === 'backlog')).toHaveLength(
      st.filter((n) => n.toLowerCase() === 'backlog').length + 1,
    );
    const acts = await raw(`select name, checks from ai_actions where project_id = $1`, [P]);
    expect(acts).toHaveLength(1);
    expect(acts[0]!.name).toBe('plan');
    expect(acts[0]!.checks).toEqual(['первое', 'второе']);
    const keys = await raw(`select kind from ai_harness_keys where project_id = $1`, [P]);
    expect(keys.map((k) => k.kind)).toContain('action');
  });

  it('questionStatus: смена настройки без других правок даёт update действия', async () => {
    expect((await post('apply')).statusCode).toBe(200);
    await raw(`update ai_actions set question_status_id = null where project_id = $1`, [P]);
    const { ops } = (await post('diff')).json();
    expect(ops.map((o: { kind: string; op: string }) => `${o.kind}.${o.op}`)).toEqual([
      'action.update',
    ]);
    expect((await post('apply')).statusCode).toBe(200);
    const [a] = await raw(`select question_status_id from ai_actions where project_id = $1`, [P]);
    expect(a!.question_status_id).toBeTruthy();
  });

  it('apply делает пакет активным, остальные — нет', async () => {
    const other = uuidv7();
    await raw(
      `insert into ai_harness_packs (id, project_id, pack_key, active, root_page_id) values ($1, $2, 'a', true, $3), ($4, $2, 'b', false, $5)`,
      [other, P, uuidv7(), uuidv7(), root],
    );
    expect((await post('apply')).statusCode).toBe(200);
    const rows = await raw(
      `select pack_key, active from ai_harness_packs where project_id = $1 order by pack_key`,
      [P],
    );
    expect(rows.map((r) => [r.pack_key, r.active])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('computeDiff: questionStatus сравнивается с текущим по ключу', () => {
    const pack = parseHarnessYaml(YML);
    const cur = {
      statuses: [{ id: 's1', name: 'Уточнение', category: 'todo', taskCount: 0 }],
      labels: [],
      fields: [],
      actions: [{ id: 'a1', name: 'plan', runtime: 'llm', checks: [], questionStatusId: 's1' }],
      rules: [],
    };
    const keys = { status: { clarify: 's1' }, action: { plan: 'a1' } };
    const d = computeDiff(cur, pack, {}, keys, {
      plan: { name: 'plan', runtime: 'llm', checks: [], prompt: '' },
    });
    expect(d.ops.filter((o) => o.kind === 'action')).toEqual([]);
  });
});
