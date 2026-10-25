import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { domainMutators, uuidv7, type Tx } from '@planar/shared';
import { MemoryTx } from '@planar/shared/testing';
import {
  mutators,
  projectToTemplate,
  taskToTemplate,
  templateIdPlan,
  type TaskTemplate,
} from '@planar/module-templates/shared';
import * as schema from '../../src/db/schema.js';
import { newDb, world, key, type World } from '../sync/helpers.js';

const db = newDb();
let w: World;
let w2: World;
const TODAY = '2026-10-25';
const NOW = '2026-10-25T10:00:00.000Z';
const doc = { type: 'doc', content: [{ type: 'paragraph' }] };

const node = (over: Partial<TaskTemplate> = {}): TaskTemplate => ({
  title: 'Шаг',
  description: null,
  priority: 2,
  dueInDays: null,
  startInDays: null,
  fields: [],
  labels: [],
  assigneeIds: [],
  checklist: [],
  subtasks: [],
  ...over,
});
const ids = (n: number) => Array.from({ length: n }, () => uuidv7());
const create = (c: World['admin'], data: unknown, kind = 'task', spaceId = w.spaceId) => {
  const id = uuidv7();
  return c
    .push('templates.create', { id, spaceId, kind, name: 'T', data })
    .then((r) => ({ id, r }));
};
const use = (tplId: string, data: TaskTemplate, over: Record<string, unknown> = {}) => ({
  templateId: tplId,
  projectId: w.projectId,
  statusId: w.statusIds[1],
  rank: 'a5',
  today: TODAY,
  ids: ids(templateIdPlan('task', data).count),
  ...over,
});
const tasksOf = (projectId: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.projectId, projectId));
const errOf = (r: unknown) => JSON.stringify(r);

let labelId: string;
let fieldId: string;
beforeAll(async () => {
  w = await world(db);
  w2 = await world(db);
  labelId = uuidv7();
  fieldId = uuidv7();
  await w.admin.ok('label.create', { id: labelId, spaceId: w.spaceId, name: 'Bug', color: '#f00' });
  await w.admin.ok('field.create', {
    id: fieldId,
    projectId: w.projectId,
    name: 'Оценка',
    type: 'number',
    rank: 'a0',
  });
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['templates'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['templates'] } });
});
afterAll(() => db.$client.end());

describe('pf2: схема и CRUD', () => {
  it('pf2: create/update/delete; createdBy = автор, kind неизменяем', async () => {
    const { id, r } = await create(w.member, node());
    expect(r).toMatchObject({ ok: true });
    const bad = await w.member.push('templates.update', { id, kind: 'project', name: 'N' });
    expect(bad).toMatchObject({ ok: true });
    const row = await db.$client.query('select * from templates_templates where id = $1', [id]);
    expect(row.rows[0]).toMatchObject({ kind: 'task', name: 'N', created_by: w.member.userId });
    await w.member.ok('templates.delete', { id });
    expect(
      (await db.$client.query('select 1 from templates_templates where id = $1', [id])).rowCount,
    ).toBe(0);
  });

  it('pf2: data не по схеме kind → invalid_args (create и update)', async () => {
    expect(errOf((await create(w.admin, { nope: 1 })).r)).toContain('invalid_args');
    expect(errOf((await create(w.admin, node(), 'project')).r)).toContain('invalid_args');
    const { id } = await create(w.admin, node());
    const r = await w.admin.push('templates.update', { id, data: node({ priority: 9 as never }) });
    expect(errOf(r)).toContain('invalid_args');
  });

  it('pf2: лимиты — название 501, чек-лист 101, подзадач 51, dueInDays 3651, data > 256 КБ', async () => {
    for (const d of [
      node({ title: 'x'.repeat(501) }),
      node({ checklist: Array(101).fill('a') }),
      node({ subtasks: Array(51).fill(node()) }),
      node({ dueInDays: 3651 }),
      node({ description: { type: 'doc', content: ['x'.repeat(300_000)] } }),
    ])
      expect(errOf((await create(w.admin, d)).r)).toContain('invalid_args');
    expect((await create(w.admin, node({ checklist: Array(100).fill('a') }))).r).toMatchObject({
      ok: true,
    });
  });

  it('pf2: проект — задача со статусом вне statuses → invalid_args', async () => {
    const p = (status: string) => ({
      project: { description: null, color: null, icon: null },
      statuses: [{ name: 'A', category: 'todo', color: '#000' }],
      labels: [],
      fields: [],
      tasks: [{ ...node(), status }],
    });
    expect(errOf((await create(w.admin, p('B'), 'project')).r)).toContain('invalid_args');
    expect((await create(w.admin, p(' a '), 'project')).r).toMatchObject({ ok: true });
  });
});

describe('pf2: templates.createTask', () => {
  it('pf2: задача, подзадачи, чек-лист, метки, поля, даты; нет метки/не участник/чужой тип — пропуск', async () => {
    const data = node({
      title: 'Релиз',
      description: doc,
      priority: 3,
      dueInDays: 7,
      startInDays: 2,
      fields: [
        { name: 'оценка ', type: 'number', value: 5 },
        { name: 'Оценка', type: 'text', value: 'x' },
      ],
      labels: [' bug', 'нет такой'],
      assigneeIds: [w.member.userId, w.outsider.userId],
      checklist: ['a', 'b'],
      subtasks: [node({ title: 'S1', checklist: ['c'] }), node({ title: 'S2' })],
    });
    const { id } = await create(w.member, data);
    const a = use(id, data);
    await w.member.ok('templates.createTask', a);
    const taskId = a.ids[0]!;
    const rows = await tasksOf(w.projectId);
    const t = rows.find((x) => x.id === taskId)!;
    expect(t).toMatchObject({
      title: 'Релиз',
      priority: 3,
      dueDate: '2026-11-01',
      startDate: '2026-10-27',
      statusId: w.statusIds[1],
      rank: 'a5',
      createdBy: w.member.userId,
      fields: { [fieldId]: 5 },
    });
    const subs = rows
      .filter((x) => x.parentId === taskId)
      .sort((x, y) => (x.rank < y.rank ? -1 : 1));
    expect(subs.map((s) => s.title)).toEqual(['S1', 'S2']);
    const cl = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.taskId, taskId))
      .orderBy(asc(schema.checklistItems.rank));
    expect(cl.map((c) => c.text)).toEqual(['a', 'b']);
    const ls = await db
      .select()
      .from(schema.taskLabels)
      .where(eq(schema.taskLabels.taskId, taskId));
    expect(ls.map((l) => l.labelId)).toEqual([labelId]);
    const as = await db
      .select()
      .from(schema.taskAssignees)
      .where(eq(schema.taskAssignees.taskId, taskId));
    expect(as.map((x) => x.userId)).toEqual([w.member.userId]);
  });

  it('pf2: не хватает ids → invalid_args; шаблон не task или другого пространства → invalid_args', async () => {
    const data = node({ checklist: ['a'], subtasks: [node()] });
    const { id } = await create(w.admin, data);
    expect(
      errOf(await w.admin.push('templates.createTask', use(id, data, { ids: ids(2) }))),
    ).toContain('invalid_args');
    expect(
      errOf(
        await w.admin.push(
          'templates.createTask',
          use(id, data, { projectId: w2.projectId, statusId: w2.statusIds[1] }),
        ),
      ),
    ).toContain('invalid_args');
    const proj = await create(
      w.admin,
      {
        project: { description: null, color: null, icon: null },
        statuses: [],
        labels: [],
        fields: [],
        tasks: [],
      },
      'project',
    );
    expect(errOf(await w.admin.push('templates.createTask', use(proj.id, data)))).toContain(
      'invalid_args',
    );
  });

  it('pf2: с parentId — задача ребёнок parentId, подзадачи шаблона — дети новой', async () => {
    const parent = uuidv7();
    await w.admin.ok('task.create', {
      id: parent,
      projectId: w.projectId,
      statusId: w.statusIds[1],
      title: 'Родитель',
      rank: 'a0',
    });
    const data = node({ title: 'Дочерняя', subtasks: [node({ title: 'Внучка' })] });
    const { id } = await create(w.admin, data);
    const a = use(id, data, { parentId: parent });
    await w.admin.ok('templates.createTask', a);
    const rows = await tasksOf(w.projectId);
    expect(rows.find((x) => x.id === a.ids[0])!.parentId).toBe(parent);
    expect(rows.find((x) => x.title === 'Внучка' && x.parentId === a.ids[0])).toBeTruthy();
  });

  it('pf2: dueInDays проходит через границу месяца и года', async () => {
    const data = node({ dueInDays: 70 });
    const { id } = await create(w.admin, data);
    const a = use(id, data, { today: '2026-12-31' });
    await w.admin.ok('templates.createTask', a);
    expect((await tasksOf(w.projectId)).find((x) => x.id === a.ids[0])!.dueDate).toBe('2027-03-11');
  });
});

// --- memory-tx: те же мутаторы дают те же строки, что сервер
class ModTx implements Tx {
  inner = new MemoryTx();
  mod = new Map<string, Map<string, Record<string, unknown>>>();
  private m(e: string) {
    let t = this.mod.get(e);
    if (!t) this.mod.set(e, (t = new Map()));
    return t;
  }
  async get(e: never, id: string) {
    return e === ('templatesTemplates' as never)
      ? (this.m(e).get(id) as never)
      : this.inner.get(e, id);
  }
  async put(e: never, row: never) {
    if (e === ('templatesTemplates' as never)) this.m(e).set((row as { id: string }).id, row);
    else await this.inner.put(e, row);
  }
  async patch(e: never, id: string, p: never) {
    if (e === ('templatesTemplates' as never))
      this.m(e).set(id, { ...this.m(e).get(id)!, ...(p as object) });
    else await this.inner.patch(e, id, p);
  }
  async del(e: never, id: string) {
    if (e === ('templatesTemplates' as never)) this.m(e).delete(id);
    else await this.inner.del(e, id);
  }
  scan(e: never, o?: never) {
    return this.inner.scan(e, o);
  }
}
const ctx = (userId: string) => ({ userId, now: NOW, server: false });
const exec = async (tx: Tx, userId: string, name: string, args: unknown) => {
  const m = [...domainMutators, ...mutators].find((x) => x.name === name)!;
  await m.run(tx, m.args.parse(args), ctx(userId));
};

describe('pf2: memory-tx', () => {
  const data = node({
    title: 'T',
    priority: 1,
    dueInDays: 3,
    fields: [{ name: 'Оценка', type: 'number', value: 8 }],
    labels: ['Bug'],
    assigneeIds: [] as string[],
    checklist: ['a', 'b', 'c'],
    subtasks: [node({ title: 'S1', checklist: ['x'] }), node({ title: 'S2' })],
  });

  async function seed(tx: Tx, spaceId: string, projectId: string, statusIds: string[]) {
    const u = uuidv7();
    for (const [i, id] of statusIds.entries())
      await tx.put('statuses', {
        id,
        spaceId,
        name: `s${i}`,
        category: 'todo',
        color: '#000',
        rank: `a${i}`,
        createdAt: NOW,
        updatedAt: NOW,
      });
    await tx.put('spaces', {
      id: spaceId,
      name: 'S',
      description: null,
      color: null,
      icon: null,
      rank: 'a0',
      createdBy: u,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await exec(tx, u, 'project.create', {
      id: projectId,
      spaceId,
      name: 'P',
      key: 'PP',
      rank: 'a0',
    });
    await exec(tx, u, 'label.create', { id: labelId, spaceId, name: 'Bug', color: '#f00' });
    await exec(tx, u, 'field.create', {
      id: fieldId,
      projectId,
      name: 'Оценка',
      type: 'number',
      rank: 'a0',
    });
    return u;
  }

  it('pf2: createTask в memory-tx даёт те же строки, что сервер', async () => {
    const { id } = await create(w.admin, data);
    const a = use(id, data);
    await w.admin.ok('templates.createTask', a);

    const tx = new ModTx();
    const u = await seed(tx, w.spaceId, w.projectId, w.statusIds);
    await tx.put(
      'templatesTemplates' as never,
      {
        id,
        spaceId: w.spaceId,
        kind: 'task',
        name: 'T',
        description: null,
        data,
        createdBy: u,
        createdAt: NOW,
        updatedAt: NOW,
      } as never,
    );
    await exec(tx, u, 'templates.createTask', a);

    const mem = (await tx.scan('tasks', { index: 'projectId', eq: w.projectId })).filter(
      (t) => t.title !== 'P',
    );
    const srv = (await tasksOf(w.projectId)).filter((t) => a.ids.includes(t.id));
    const pick = (t: {
      id: string;
      title: string;
      parentId: string | null;
      rank: string;
      priority: number;
      dueDate: string | null;
      fields: unknown;
      statusId: string;
    }) => ({
      id: t.id,
      title: t.title,
      parentId: t.parentId,
      rank: t.rank,
      priority: t.priority,
      dueDate: t.dueDate,
      fields: t.fields,
      statusId: t.statusId,
    });
    const sort = <T extends { id: string }>(l: T[]) => l.sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(sort(mem.map(pick))).toEqual(sort(srv.map(pick)));
    const memCl = (await tx.scan('checklistItems')).map((c) => ({
      id: c.id,
      text: c.text,
      rank: c.rank,
      taskId: c.taskId,
    }));
    const srvCl = (await db.select().from(schema.checklistItems))
      .filter((c) => a.ids.includes(c.id))
      .map((c) => ({ id: c.id, text: c.text, rank: c.rank, taskId: c.taskId }));
    expect(sort(memCl)).toEqual(sort(srvCl));
    expect(memCl).toHaveLength(4);
  });

  it('pf2: круг «сохранить → создать» сохраняет поля, чек-лист, подзадачи', async () => {
    const tx = new ModTx();
    const u = await seed(tx, w.spaceId, w.projectId, w.statusIds);
    const src = uuidv7();
    await exec(tx, u, 'task.create', {
      id: src,
      projectId: w.projectId,
      statusId: w.statusIds[0],
      title: 'Исходная',
      rank: 'a0',
      priority: 4,
      dueDate: '2026-10-30',
      labels: [{ id: uuidv7(), labelId }],
    });
    await exec(tx, u, 'task.setField', { taskId: src, fieldId, value: 13 });
    await exec(tx, u, 'checklist.add', { id: uuidv7(), taskId: src, text: 'один', rank: 'a1' });
    await exec(tx, u, 'checklist.add', { id: uuidv7(), taskId: src, text: 'два', rank: 'a2' });
    await exec(tx, u, 'task.create', {
      id: uuidv7(),
      projectId: w.projectId,
      statusId: w.statusIds[0],
      title: 'Дочерняя',
      rank: 'a0',
      parentId: src,
    });

    const saved = await taskToTemplate(src, tx, TODAY);
    expect(saved).toMatchObject({
      title: 'Исходная',
      priority: 4,
      dueInDays: 5,
      labels: ['Bug'],
      fields: [{ name: 'Оценка', type: 'number', value: 13 }],
      checklist: ['один', 'два'],
    });
    expect(saved.subtasks.map((s) => s.title)).toEqual(['Дочерняя']);

    const tid = uuidv7();
    await exec(tx, u, 'templates.create', {
      id: tid,
      spaceId: w.spaceId,
      kind: 'task',
      name: 'X',
      data: saved,
    });
    const a = use(tid, saved);
    await exec(tx, u, 'templates.createTask', a);
    expect(await taskToTemplate(a.ids[0]!, tx, TODAY)).toEqual(saved);
  });

  it('pf2: проект → шаблон → проект: статусы/метки не дублируются, поля и задачи переносятся', async () => {
    const tx = new ModTx();
    const u = await seed(tx, w.spaceId, w.projectId, w.statusIds);
    await exec(tx, u, 'task.create', {
      id: uuidv7(),
      projectId: w.projectId,
      statusId: w.statusIds[2],
      title: 'К',
      rank: 'a0',
    });
    const pt = await projectToTemplate(w.projectId, tx, TODAY);
    pt.statuses.push({ name: 'Ревью', category: 'in_progress', color: '#0f0' });
    pt.labels.push({ name: 'Новая', color: '#00f' });
    pt.tasks.push({ ...node({ title: 'В ревью' }), status: ' ревью ' });
    const tid = uuidv7();
    await exec(tx, u, 'templates.create', {
      id: tid,
      spaceId: w.spaceId,
      kind: 'project',
      name: 'P',
      data: pt,
    });
    const pid = uuidv7();
    const nIds = ids(templateIdPlan('project', pt).count);
    await exec(tx, u, 'templates.createProject', {
      templateId: tid,
      projectId: pid,
      name: 'Копия',
      key: 'CP',
      rank: 'a1',
      today: TODAY,
      ids: nIds,
    });
    const sts = await tx.scan('statuses', { index: 'spaceId', eq: w.spaceId });
    expect(sts.map((s) => s.name).sort()).toEqual(
      ['Ревью', ...w.statusIds.map((_, i) => `s${i}`)].sort(),
    );
    expect(
      (await tx.scan('labels', { index: 'spaceId', eq: w.spaceId })).map((l) => l.name).sort(),
    ).toEqual(['Bug', 'Новая']);
    expect(
      (await tx.scan('fieldDefs', { index: 'projectId', eq: pid })).map((f) => f.name),
    ).toEqual(['Оценка']);
    const copy = await projectToTemplate(pid, tx, TODAY);
    expect(copy.tasks.map((t) => [t.title, t.status]).sort()).toEqual([
      ['В ревью', 'Ревью'],
      ['К', 's2'],
    ]);
  });
});

describe('pf2: templates.createProject на сервере', () => {
  const tpl = (names: string[], labels: string[]) => ({
    project: { description: doc, color: '#123456', icon: null },
    statuses: names.map((name) => ({ name, category: 'in_progress', color: '#abc' })),
    labels: labels.map((name) => ({ name, color: '#def' })),
    fields: [{ name: 'Срок', type: 'date', options: {} }],
    tasks: [
      {
        ...node({ title: 'Первая', fields: [{ name: 'Срок', type: 'date', value: '2027-01-01' }] }),
        status: names[0]!,
      },
    ],
  });
  const body = (tid: string, data: ReturnType<typeof tpl>) => ({
    templateId: tid,
    projectId: uuidv7(),
    name: 'Из шаблона',
    key: key(),
    rank: 'a9',
    today: TODAY,
    ids: ids(templateIdPlan('project', data).count),
  });

  it('pf2: admin — недостающие статусы и метки создаются, существующие (без регистра) нет', async () => {
    const existing = (
      await db
        .select()
        .from(schema.statuses)
        .where(eq(schema.statuses.spaceId, w.spaceId))
        .orderBy(asc(schema.statuses.rank))
    )[0]!;
    const data = tpl([`  ${existing.name.toUpperCase()} `, 'Ревью-1'], ['bug', 'Свежая']);
    const { id } = await create(w.admin, data, 'project');
    const b = body(id, data);
    await w.admin.ok('templates.createProject', b);
    const sts = await db
      .select()
      .from(schema.statuses)
      .where(eq(schema.statuses.spaceId, w.spaceId));
    expect(sts.filter((s) => s.name === 'Ревью-1')).toHaveLength(1);
    expect(sts).toHaveLength(6);
    const maxRank = sts
      .filter((s) => s.name !== 'Ревью-1')
      .map((s) => s.rank)
      .sort()
      .at(-1)!;
    expect(sts.find((s) => s.name === 'Ревью-1')!.rank > maxRank).toBe(true);
    const lbs = await db.select().from(schema.labels).where(eq(schema.labels.spaceId, w.spaceId));
    expect(lbs.map((l) => l.name).sort()).toEqual(['Bug', 'Свежая']);
    const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, b.projectId));
    expect(p).toMatchObject({ name: 'Из шаблона', color: '#123456' });
    const t = (await tasksOf(b.projectId))[0]!;
    expect(t).toMatchObject({ title: 'Первая', statusId: existing.id });
    const [f] = await db
      .select()
      .from(schema.fieldDefs)
      .where(and(eq(schema.fieldDefs.projectId, b.projectId)));
    expect(t.fields).toEqual({ [f!.id]: '2027-01-01' });
  });

  it('pf2: не admin с новым статусом → forbidden, без нового — ok', async () => {
    const data = tpl(['Только-админ'], []);
    const { id } = await create(w.member, data, 'project');
    expect(errOf(await w.member.push('templates.createProject', body(id, data)))).toContain(
      'forbidden',
    );
    const st = (
      await db.select().from(schema.statuses).where(eq(schema.statuses.spaceId, w.spaceId))
    )[0]!;
    const known = tpl([st.name], []);
    const k = await create(w.member, known, 'project');
    await w.member.ok('templates.createProject', body(k.id, known));
  });
});

describe('pf2: templateIdPlan', () => {
  it('pf2: считает задачу, исполнителей, метки, пункты, подзадачи', () => {
    const d = node({
      labels: ['a'],
      assigneeIds: [uuidv7(), uuidv7()],
      checklist: ['x'],
      subtasks: [node({ checklist: ['y', 'z'] })],
    });
    expect(templateIdPlan('task', d).count).toBe(1 + 1 + 2 + 1 + (1 + 2));
    expect(() => templateIdPlan('task', { bad: 1 })).toThrow();
  });
});
