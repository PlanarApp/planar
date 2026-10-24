import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  type EntityName,
  type SharedModuleManifest,
  type Tx,
} from '@planar/shared';

const ts = z.iso.datetime();
const uuid = z.uuid();
const bad = (msg: string) => new MutatorError('invalid_args', msg);

export const SLUG_RE = /^[a-z0-9]{16}$/;
const KEY_RE = /^(title|description|email|files|field:[0-9a-fA-F-]{36})$/;

export const formField = z.object({
  key: z.string().regex(KEY_RE),
  label: z.string().min(1).max(200),
  required: z.boolean(),
});
export type FormField = z.infer<typeof formField>;

/** title есть всегда и обязателен; ключи без повторов; ≤ 30 полей. */
export const formFields = z
  .array(formField)
  .max(30)
  .refine((f) => new Set(f.map((x) => x.key)).size === f.length, 'ключи без повторов')
  .refine((f) => f.some((x) => x.key === 'title' && x.required), 'title обязателен');

export const formsForms = z.object({
  id: uuid,
  spaceId: uuid,
  projectId: uuid,
  slug: z.string().regex(SLUG_RE),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  fields: z.json(),
  statusId: uuid,
  enabled: z.boolean(),
  createdBy: uuid,
  createdAt: ts,
  updatedAt: ts,
});
export type FormsForm = z.output<typeof formsForms>;

// Tx типизирован сущностями ядра; сущности модулей приводим (C-modules)
interface MTx {
  get(e: string, id: string): Promise<unknown>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
}
const mtx = (tx: Tx) => tx as unknown as MTx;
const E = 'formsForms' as EntityName;

async function need(tx: Tx, id: string) {
  const f = (await mtx(tx).get(E, id)) as FormsForm | undefined;
  if (!f) throw new MutatorError('not_found', `formsForms ${id}`);
  return f;
}

async function checkStatus(tx: Tx, statusId: string, spaceId: string) {
  const st = await tx.get('statuses', statusId);
  if (!st) throw new MutatorError('not_found', `statuses ${statusId}`);
  if (st.spaceId !== spaceId) throw bad('statusId другого пространства');
}

/** Схема корректна и каждый `field:<id>` — поле проекта формы. */
async function checkFields(tx: Tx, projectId: string, raw: unknown): Promise<FormField[]> {
  const p = formFields.safeParse(raw);
  if (!p.success) throw bad(`fields: ${p.error.issues[0]?.message}`);
  for (const f of p.data)
    if (f.key.startsWith('field:')) {
      const def = await tx.get('fieldDefs', f.key.slice(6));
      if (!def || def.projectId !== projectId) throw bad(`${f.key} не из проекта формы`);
    }
  return p.data;
}

const description = z.string().max(2000);

export const mutators = [
  defineMutator({
    name: 'forms.create',
    args: z.object({
      id: uuid,
      projectId: uuid,
      slug: z.string().regex(SLUG_RE),
      title: z.string().min(1).max(200),
      statusId: uuid,
      fields: z.json(),
      description: description.optional(),
    }),
    async run(tx, a, ctx) {
      const project = await tx.get('projects', a.projectId);
      if (!project) throw new MutatorError('not_found', `projects ${a.projectId}`);
      await checkStatus(tx, a.statusId, project.spaceId);
      const fields = await checkFields(tx, a.projectId, a.fields);
      if (await mtx(tx).get(E, a.id)) throw new MutatorError('conflict', 'форма уже есть');
      await mtx(tx).put(E, {
        id: a.id,
        spaceId: project.spaceId,
        projectId: a.projectId,
        slug: a.slug,
        title: a.title,
        description: a.description ?? null,
        fields,
        statusId: a.statusId,
        enabled: true,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'forms.update',
    args: z.object({
      id: uuid,
      title: z.string().min(1).max(200).optional(),
      description: description.nullable().optional(),
      fields: z.json().optional(),
      statusId: uuid.optional(),
      enabled: z.boolean().optional(),
      slug: z.string().regex(SLUG_RE).optional(),
    }),
    async run(tx, a, ctx) {
      const f = await need(tx, a.id);
      if (a.statusId) await checkStatus(tx, a.statusId, f.spaceId);
      const patch: Record<string, unknown> = {
        ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)),
        updatedAt: ctx.now,
      };
      delete patch.id;
      if (a.fields !== undefined) patch.fields = await checkFields(tx, f.projectId, a.fields);
      await mtx(tx).patch(E, a.id, patch);
    },
  }),
  defineMutator({
    name: 'forms.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await need(tx, a.id);
      await mtx(tx).del(E, a.id);
    },
  }),
];

export const shared: SharedModuleManifest = {
  id: 'forms',
  mutators,
  entities: {
    formsForms: {
      schema: formsForms,
      meta: { scope: 'space', write: 'admin', bootstrap: true, indexes: ['spaceId', 'projectId'] },
    },
  },
};
