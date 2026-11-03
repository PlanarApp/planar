import { expect, it } from 'vitest';
import { addProject, code, id, mem, run, seedSpace, seedTask, U1 } from './helpers';

const setup = async () => {
  const tx = mem();
  const s = await seedSpace(tx);
  return { tx, s, t: await seedTask(tx, s) };
};
const mkField = async (
  tx: ReturnType<typeof mem>,
  projectId: string,
  type: string,
  options?: object,
) => {
  const f = id();
  await run(tx, 'field.create', { id: f, projectId, name: type, type, options, rank: 'a0' });
  return f;
};
const fieldsOf = async (tx: ReturnType<typeof mem>, t: string) =>
  (await tx.get('tasks', t))!.fields;

const CASES: [string, object | undefined, unknown, unknown][] = [
  ['text', undefined, 'hello', ''],
  ['number', undefined, 3.5, '3'],
  ['date', undefined, '2026-10-23', '23.10.2026'],
  ['select', { choices: [{ id: 'a', label: 'A' }] }, 'a', 'b'],
  ['user', undefined, U1, id()],
  ['url', undefined, 'https://x.io/p', 'ftp://x.io'],
  ['money', { currency: 'USD' }, 1050, 10.5],
];

for (const [type, options, good, badValue] of CASES) {
  it(`fields: ${type} — верное значение принято, неверное отклонено`, async () => {
    const { tx, s, t } = await setup();
    const f = await mkField(tx, s.projectId, type, options);
    if (type === 'user')
      await tx.put('users', {
        id: U1,
        login: 'u',
        name: 'U',
        email: null,
        role: 'member',
        avatarFile: null,
        deactivatedAt: null,
        createdAt: '2026-10-22T10:00:00.000Z',
        updatedAt: '2026-10-22T10:00:00.000Z',
      });
    await run(tx, 'task.setField', { taskId: t, fieldId: f, value: good });
    expect(await fieldsOf(tx, t)).toEqual({ [f]: good });
    expect(await code(run(tx, 'task.setField', { taskId: t, fieldId: f, value: badValue }))).toBe(
      'invalid_args',
    );
    expect(await fieldsOf(tx, t)).toEqual({ [f]: good });
  });
}

it('fields: null убирает ключ, остальные остаются', async () => {
  const { tx, s, t } = await setup();
  const a = await mkField(tx, s.projectId, 'text');
  const b = await mkField(tx, s.projectId, 'number');
  await run(tx, 'task.setField', { taskId: t, fieldId: a, value: 'x' });
  await run(tx, 'task.setField', { taskId: t, fieldId: b, value: 1 });
  await run(tx, 'task.setField', { taskId: t, fieldId: a, value: null });
  expect(await fieldsOf(tx, t)).toEqual({ [b]: 1 });
});

it('fields: поле чужого проекта отклонено', async () => {
  const { tx, s, t } = await setup();
  const p2 = id();
  await addProject(tx, s.spaceId, p2, 'QQ', 'a1');
  const f = await mkField(tx, p2, 'text');
  expect(await code(run(tx, 'task.setField', { taskId: t, fieldId: f, value: 'x' }))).toBe(
    'invalid_args',
  );
});

it('fields: field.delete чистит значения, задачи остаются', async () => {
  const { tx, s, t } = await setup();
  const f = await mkField(tx, s.projectId, 'text');
  const g = await mkField(tx, s.projectId, 'text');
  await run(tx, 'task.setField', { taskId: t, fieldId: f, value: 'x' });
  await run(tx, 'task.setField', { taskId: t, fieldId: g, value: 'y' });
  await run(tx, 'field.delete', { id: f });
  expect(await tx.get('fieldDefs', f)).toBeUndefined();
  expect(await fieldsOf(tx, t)).toEqual({ [g]: 'y' });
});

it('fields: удалённый вариант select чистит значения', async () => {
  const { tx, s, t } = await setup();
  const t2 = await seedTask(tx, s);
  const f = await mkField(tx, s.projectId, 'select', {
    choices: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  });
  await run(tx, 'task.setField', { taskId: t, fieldId: f, value: 'a' });
  await run(tx, 'task.setField', { taskId: t2, fieldId: f, value: 'b' });
  await run(tx, 'field.update', { id: f, options: { choices: [{ id: 'b', label: 'B2' }] } });
  expect(await fieldsOf(tx, t)).toEqual({});
  expect(await fieldsOf(tx, t2)).toEqual({ [f]: 'b' });
});

it('fields: неверные options и дубли вариантов отклонены', async () => {
  const { tx, s } = await setup();
  const mk = (type: string, options: object) =>
    code(
      run(tx, 'field.create', {
        id: id(),
        projectId: s.projectId,
        name: 'n',
        type,
        options,
        rank: 'a',
      }),
    );
  expect(await mk('money', { currency: 'rub' })).toBe('invalid_args');
  expect(
    await mk('select', {
      choices: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ],
    }),
  ).toBe('invalid_args');
});

it('fields: defaultFieldOptions при создании', async () => {
  const { tx, s } = await setup();
  const m = await mkField(tx, s.projectId, 'money');
  const sel = await mkField(tx, s.projectId, 'select');
  expect((await tx.get('fieldDefs', m))!.options).toEqual({ currency: 'RUB' });
  expect((await tx.get('fieldDefs', sel))!.options).toEqual({ choices: [] });
});

it('fields: task.update с неверным fields отклонён, с верным — заменяет', async () => {
  const { tx, s, t } = await setup();
  const f = await mkField(tx, s.projectId, 'number');
  await run(tx, 'task.update', { id: t, fields: { [f]: 5 } });
  expect(await fieldsOf(tx, t)).toEqual({ [f]: 5 });
  expect(await code(run(tx, 'task.update', { id: t, fields: { [f]: 'x' } }))).toBe('invalid_args');
  expect(await code(run(tx, 'task.update', { id: t, fields: { [id()]: 1 } }))).toBe('invalid_args');
  await run(tx, 'task.update', { id: t, fields: {} });
  expect(await fieldsOf(tx, t)).toEqual({});
});

it('fields: смена проекта обнуляет fields', async () => {
  const { tx, s, t } = await setup();
  const f = await mkField(tx, s.projectId, 'text');
  await run(tx, 'task.setField', { taskId: t, fieldId: f, value: 'x' });
  const p2 = id();
  await addProject(tx, s.spaceId, p2, 'QQ', 'a1');
  await run(tx, 'task.update', { id: t, projectId: p2 });
  expect(await fieldsOf(tx, t)).toEqual({});
});

it('fields: ключ без определения не пишется через setField', async () => {
  const { tx, t } = await setup();
  expect(await code(run(tx, 'task.setField', { taskId: t, fieldId: id(), value: 'x' }))).toBe(
    'invalid_args',
  );
});

it('fields: project.delete удаляет fieldDefs проекта', async () => {
  const { tx, s } = await setup();
  const p2 = id();
  await addProject(tx, s.spaceId, p2, 'QQ', 'a1');
  const f = await mkField(tx, p2, 'text');
  await run(tx, 'project.delete', { id: p2 });
  expect(await tx.get('fieldDefs', f)).toBeUndefined();
});
