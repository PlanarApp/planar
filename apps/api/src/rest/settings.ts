import { asc, desc, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import { domainMutators, uuidv7, type MutatorDef } from '@planar/shared';
import { shared as aiShared } from '@planar/module-ai/shared';
import { shared as automationsShared } from '@planar/module-automations/shared';
import { HttpError } from '../auth/errors.js';
import type { Db } from '../db/index.js';
import * as s from '../db/schema.js';
import { moduleOnInProject } from '../modules/enabled.js';
import { moduleTables } from '../modules/installed.js';
import { toWire } from '../sync/rows.js';

/**
 * Project settings over the existing mutators (PLNRAPP-266): no logic of its own — a request becomes one
 * mutation as the user (executeMutations checks the rights). Secrets (AI connections, GitLab, mail,
 * webhooks, AI limits) are deliberately absent.
 */
const all = [
  ...domainMutators,
  ...(aiShared.mutators ?? []),
  ...(automationsShared.mutators ?? []),
];
const args = (name: string) => {
  const m = all.find((x: MutatorDef) => x.name === name);
  if (!m) throw new Error(`mutator ${name}`);
  return m.args as unknown as z.ZodObject;
};

type Entity = 'statuses' | 'labels' | 'fieldDefs' | 'automationsRules' | 'aiActions' | 'projects';
interface Op {
  /** mutator name */
  mutator: string;
  entity: Entity;
  kind: 'create' | 'update' | 'delete';
  /** MCP tool name */
  tool: string;
  description: string;
  /** full input (ids included): the MCP tool shape; REST takes ids from the path */
  schema: z.ZodObject;
  /** module whose data the entity lives in (must be on in the project) */
  module?: string;
}

const STATUS = args('status.create');
const op = (
  mutator: string,
  entity: Entity,
  kind: Op['kind'],
  tool: string,
  description: string,
  schema = args(mutator),
  module?: string,
): Op => ({ mutator, entity, kind, tool, description, schema, module });
const noId = <T extends z.ZodObject>(sc: T) => sc.omit({ id: true } as never) as T;

export const SETTING_OPS: Op[] = [
  op(
    'status.create',
    'statuses',
    'create',
    'create_status',
    'Создать статус проекта (rank и color необязательны)',
    noId(STATUS).extend({ color: z.string().optional(), rank: z.string().min(1).optional() }),
  ),
  op(
    'status.update',
    'statuses',
    'update',
    'update_status',
    'Изменить статус: название, категория, цвет, rank',
  ),
  op(
    'status.delete',
    'statuses',
    'delete',
    'delete_status',
    'Удалить статус; задачи переходят в replaceWith (другой статус проекта)',
  ),
  op(
    'label.create',
    'labels',
    'create',
    'create_label',
    'Создать метку проекта',
    noId(args('label.create')).extend({ color: z.string().optional() }),
  ),
  op('label.update', 'labels', 'update', 'update_label', 'Изменить метку: название, цвет'),
  op('label.delete', 'labels', 'delete', 'delete_label', 'Удалить метку (снимается с задач)'),
  op(
    'field.create',
    'fieldDefs',
    'create',
    'create_field',
    'Создать пользовательское поле проекта (type, options по типу; rank необязателен)',
    noId(args('field.create')).extend({ rank: z.string().min(1).optional() }),
  ),
  op(
    'field.update',
    'fieldDefs',
    'update',
    'update_field',
    'Изменить поле: название, options, rank (тип не меняется)',
  ),
  op(
    'field.delete',
    'fieldDefs',
    'delete',
    'delete_field',
    'Удалить поле вместе со значениями в задачах',
  ),
  op(
    'automations.create',
    'automationsRules',
    'create',
    'create_automation',
    'Создать правило автоматизации проекта (trigger, conditions, actions)',
    noId(args('automations.create')),
    'automations',
  ),
  op(
    'automations.update',
    'automationsRules',
    'update',
    'update_automation',
    'Изменить правило автоматизации (в том числе enabled)',
    undefined,
    'automations',
  ),
  op(
    'automations.delete',
    'automationsRules',
    'delete',
    'delete_automation',
    'Удалить правило автоматизации',
    undefined,
    'automations',
  ),
  op(
    'ai.action.create',
    'aiActions',
    'create',
    'create_ai_action',
    'Создать ИИ-действие проекта (key, name, страница-инструкция pageId, checks — критерии приёмки, «$ команда» — проверка в контейнере агента, maxAttempts — попыток до вопроса человеку)',
    noId(args('ai.action.create')),
    'ai',
  ),
  op(
    'ai.action.update',
    'aiActions',
    'update',
    'update_ai_action',
    'Изменить ИИ-действие',
    undefined,
    'ai',
  ),
  op(
    'ai.action.delete',
    'aiActions',
    'delete',
    'delete_ai_action',
    'Удалить ИИ-действие',
    undefined,
    'ai',
  ),
  op(
    'project.update',
    'projects',
    'update',
    'update_project',
    'Изменить поля проекта: название, ключ, описание, цвет, иконка, руководитель, исполнитель по умолчанию, архив',
  ),
];

/** project.setModule is not create/update/delete of a row: its own input and tool */
export const setModuleSchema = args('project.setModule');

export const opByMutator = (m: string) => SETTING_OPS.find((o) => o.mutator === m)!;

const table = (e: Entity): PgTable =>
  ({ statuses: s.statuses, labels: s.labels, fieldDefs: s.fieldDefs, projects: s.projects })[
    e as 'statuses'
  ] ?? moduleTables().get(e)!;
const col = (t: PgTable, name: string) =>
  (t as unknown as Record<string, PgColumn>)[name] as PgColumn;

export interface SettingsDeps {
  db: Db;
  run(userId: string, muts: { name: string; args: unknown }[], tokenId?: string): Promise<void>;
  /** 404 for a foreign / hidden project */
  visibleProject(userId: string, id: string): Promise<string>;
}

const NOT_FOUND = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);

async function row(db: Db, e: Entity, id: string) {
  const t = table(e);
  const [r] = await db
    .select()
    .from(t)
    .where(eq(col(t, 'id'), id));
  return r as Record<string, unknown> | undefined;
}

/** the last rank of the project's rows, to append a new one at the end */
async function nextRank(db: Db, e: 'statuses' | 'fieldDefs', projectId: string) {
  const t = table(e);
  const [last] = await db
    .select({ rank: col(t, 'rank') })
    .from(t)
    .where(eq(col(t, 'projectId'), projectId) as SQL)
    .orderBy(desc(col(t, 'rank')))
    .limit(1);
  return generateKeyBetween((last?.rank as string | undefined) ?? null, null);
}

/** One settings operation as the user; `input` is already merged from path and body. Returns the row (null after delete). */
export async function runSetting(
  d: SettingsDeps,
  userId: string,
  mutator: string,
  input: unknown,
  tokenId?: string,
) {
  const o = opByMutator(mutator);
  const a = parseInput(o.schema, input);
  let projectId: string;
  let id = a.id as string | undefined;
  if (o.kind === 'create') projectId = a.projectId as string;
  else {
    const r = z.uuid().safeParse(id).success ? await row(d.db, o.entity, id!) : undefined;
    if (!r) throw NOT_FOUND('Объект');
    projectId = (o.entity === 'projects' ? r.id : r.projectId) as string;
  }
  await d.visibleProject(userId, projectId);
  if (o.module && !(await moduleOnInProject(d.db, o.module, projectId)))
    throw new HttpError(404, 'module_disabled', `Модуль ${o.module} выключен`);
  if (o.kind === 'create') {
    id = uuidv7();
    a.id = id;
    if (o.entity === 'statuses') {
      a.color ??= '#6b7280';
      a.rank ??= await nextRank(d.db, 'statuses', projectId);
    }
    if (o.entity === 'labels') a.color ??= '#6b7280';
    if (o.entity === 'fieldDefs') a.rank ??= await nextRank(d.db, 'fieldDefs', projectId);
  }
  await d.run(userId, [{ name: o.mutator, args: a }], tokenId);
  if (o.kind === 'delete') return null;
  return toWire(o.entity, (await row(d.db, o.entity, id!)) as never);
}

export async function runSetModule(
  d: SettingsDeps,
  userId: string,
  input: unknown,
  tokenId?: string,
) {
  const a = parseInput(setModuleSchema, input);
  await d.visibleProject(userId, a.projectId as string);
  await d.run(userId, [{ name: 'project.setModule', args: a }], tokenId);
  return toWire('projects', (await row(d.db, 'projects', a.projectId as string)) as never);
}

export async function listAiActions(d: SettingsDeps, userId: string, projectId: string) {
  const pid = await d.visibleProject(userId, projectId);
  if (!(await moduleOnInProject(d.db, 'ai', pid)))
    throw new HttpError(404, 'module_disabled', 'Модуль ai выключен');
  const t = table('aiActions');
  const rows = await d.db
    .select()
    .from(t)
    .where(eq(col(t, 'projectId'), pid) as SQL)
    .orderBy(asc(col(t, 'createdAt')), asc(col(t, 'id')));
  return rows.map((r) => toWire('aiActions', r as never));
}

function parseInput(schema: z.ZodObject, data: unknown): Record<string, unknown> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Неверные параметры', r.error.issues);
  return r.data as Record<string, unknown>;
}
