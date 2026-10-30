import { z } from 'zod';
import { defineMutator, entitySchemas, type Row, type Tx } from '../contract/index.js';
import { defaultFieldOptions, fieldOptionsSchema, fieldValueSchema } from '../fields.js';
import { bad, changes, name, need, rank, uuid } from './util.js';

/** Field value by definition; null/undefined is not allowed. */
export async function checkValue(tx: Tx, def: Row<'fieldDefs'>, value: unknown) {
  if (!fieldValueSchema(def).safeParse(value).success) throw bad(`значение поля ${def.name}`);
  if (def.type === 'user' && !(await tx.get('users', value as string)))
    throw bad('нет такого пользователя');
}

/** Full replacement of the task `fields` of project `projectId`: each key is a project field. */
export async function checkFields(tx: Tx, projectId: string, fields: Record<string, unknown>) {
  for (const [k, v] of Object.entries(fields)) {
    const def = await tx.get('fieldDefs', k);
    if (!def || def.projectId !== projectId) throw bad(`поле ${k} не из проекта`);
    await checkValue(tx, def, v);
  }
}

/** Remove from the fields of the project's tasks the values for which drop(def-value) is true. */
async function scrub(tx: Tx, projectId: string, fieldId: string, drop: (v: unknown) => boolean) {
  for (const t of await tx.scan('tasks', { index: 'projectId', eq: projectId })) {
    if (!(fieldId in t.fields) || !drop(t.fields[fieldId])) continue;
    const rest = { ...t.fields };
    delete rest[fieldId];
    await tx.patch('tasks', t.id, { fields: rest });
  }
}

const type = entitySchemas.fieldDefs.shape.type;

export const fieldMutators = [
  defineMutator({
    name: 'task.setField',
    args: z.object({ taskId: uuid, fieldId: uuid, value: z.json() }),
    async run(tx, a, ctx) {
      const t = await need(tx, 'tasks', a.taskId);
      const def = await tx.get('fieldDefs', a.fieldId);
      if (!def || def.projectId !== t.projectId) throw bad('поле другого проекта');
      const rest = { ...t.fields };
      delete rest[a.fieldId];
      if (a.value === null)
        return void (await tx.patch('tasks', t.id, { fields: rest, updatedAt: ctx.now }));
      await checkValue(tx, def, a.value);
      await tx.patch('tasks', t.id, {
        fields: { ...rest, [a.fieldId]: a.value },
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'field.create',
    args: z.object({
      id: uuid,
      projectId: uuid,
      name,
      type,
      options: z.record(z.string(), z.unknown()).optional(),
      rank,
    }),
    async run(tx, a, ctx) {
      const p = await need(tx, 'projects', a.projectId);
      const options = a.options ?? defaultFieldOptions(a.type);
      if (!fieldOptionsSchema(a.type).safeParse(options).success) throw bad('options');
      await tx.put('fieldDefs', {
        ...a,
        options,
        spaceId: p.spaceId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'field.update',
    args: z.object({
      id: uuid,
      name: name.optional(),
      options: z.record(z.string(), z.unknown()).optional(),
      rank: rank.optional(),
    }),
    async run(tx, a, ctx) {
      const def = await need(tx, 'fieldDefs', a.id);
      if (a.options) {
        if (!fieldOptionsSchema(def.type).safeParse(a.options).success) throw bad('options');
        if (def.type === 'select') {
          const keep = new Set((a.options.choices as { id: string }[]).map((c) => c.id));
          await scrub(tx, def.projectId, def.id, (v) => !keep.has(v as string));
        }
      }
      await tx.patch('fieldDefs', a.id, changes('fieldDefs', a, ctx));
    },
  }),
  defineMutator({
    name: 'field.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      const def = await need(tx, 'fieldDefs', a.id);
      await scrub(tx, def.projectId, def.id, () => true);
      await tx.del('fieldDefs', a.id);
    },
  }),
];
