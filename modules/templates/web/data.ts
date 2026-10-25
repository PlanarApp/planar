// Единственная точка контакта модуля с ядром web: реплика, мутации, язык.
import { reactive } from 'vue';
import {
  db,
  i18n,
  localToday,
  mutate,
  newId,
  openTask,
  rankBetween,
  useQuery,
} from '@planar/web/modules';
import {
  projectToTemplate,
  taskToTemplate,
  templateIdPlan,
  type Reader,
  type TemplateKind,
  type TemplateRow,
} from '../shared/index.js';

export { mutate, localToday };

/** Диалоги, которые открывают команды (рисует TemplatesHost в topbar). */
export const ui = reactive<{ newTask: string | null; saveTask: string | null }>({
  newTask: null,
  saveTask: null,
});

export const useTemplates = (spaceId: () => string, kind?: TemplateKind) =>
  useQuery(async () => {
    const rows = (await db
      .table('templatesTemplates')
      .where('spaceId')
      .equals(spaceId())
      .toArray()) as TemplateRow[];
    return rows
      .filter((r) => !kind || r.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

export const useProjects = (spaceId: () => string) =>
  useQuery(
    async () =>
      (await db.table('projects').where('spaceId').equals(spaceId()).toArray()).filter(
        (p) => !p.archivedAt,
      ) as { id: string; name: string; key: string; rank: string }[],
  );

const read: Reader = {
  get: (e, id) => db.table(e).get(id),
  scan: (e, o) =>
    (o
      ? db
          .table(e)
          .where(o.index)
          .equals(o.eq as string)
      : db.table(e)
    ).toArray(),
} as Reader;

const byRank = (a: { rank: string }, b: { rank: string }) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
const ids = (kind: TemplateKind, data: unknown) =>
  Array.from({ length: templateIdPlan(kind, data).count }, newId);

/** Задача из шаблона: статус по умолчанию — первый todo, иначе первый по rank; в конец статуса. */
export async function createTaskFrom(templateId: string, projectId: string): Promise<void> {
  const tpl = (await db.table('templatesTemplates').get(templateId)) as TemplateRow | undefined;
  const project = await db.table('projects').get(projectId);
  if (!tpl || !project) return;
  const st = (await db.table('statuses').where('spaceId').equals(project.spaceId).toArray()).sort(
    byRank,
  );
  const status = st.find((s) => s.category === 'todo') ?? st[0];
  if (!status) return;
  const tasks = await db.table('tasks').where('projectId').equals(projectId).toArray();
  const last =
    tasks
      .filter((t) => t.statusId === status.id)
      .map((t) => t.rank)
      .sort()
      .at(-1) ?? null;
  const planned = ids('task', tpl.data);
  await mutate('templates.createTask', {
    templateId,
    projectId,
    statusId: status.id,
    rank: rankBetween(last, null),
    today: localToday(),
    ids: planned,
  });
  openTask(planned[0]!);
}

export async function createProjectFrom(
  templateId: string,
  name: string,
  key: string,
): Promise<void> {
  const tpl = (await db.table('templatesTemplates').get(templateId)) as TemplateRow | undefined;
  if (!tpl) return;
  const projects = await db.table('projects').where('spaceId').equals(tpl.spaceId).toArray();
  await mutate('templates.createProject', {
    templateId,
    projectId: newId(),
    name,
    key,
    rank: rankBetween(
      projects
        .map((p) => p.rank)
        .sort()
        .at(-1) ?? null,
      null,
    ),
    today: localToday(),
    ids: ids('project', tpl.data),
  });
}

async function save(spaceId: string, kind: TemplateKind, name: string, data: unknown) {
  await mutate('templates.create', { id: newId(), spaceId, kind, name, data });
}
export async function saveTaskAs(taskId: string, name: string): Promise<void> {
  const t = await db.table('tasks').get(taskId);
  if (t) await save(t.spaceId, 'task', name, await taskToTemplate(taskId, read, localToday()));
}
export async function saveProjectAs(projectId: string, name: string): Promise<void> {
  const p = await db.table('projects').get(projectId);
  if (p)
    await save(p.spaceId, 'project', name, await projectToTemplate(projectId, read, localToday()));
}

/** Открытая задача (панель `?task=` или экран /t/) по ключу `KEY-N` или id. */
export async function taskIdByKey(key: string): Promise<string | undefined> {
  const byId = await db.table('tasks').get(key);
  if (byId) return byId.id;
  const m = /^(.+)-(\d+)$/.exec(key);
  if (!m) return undefined;
  const p = (await db.table('projects').toArray()).find((x) => x.key === m[1]);
  if (!p) return undefined;
  return (await db.table('tasks').where('projectId').equals(p.id).toArray()).find(
    (t) => t.number === Number(m[2]),
  )?.id;
}

const dict = {
  title: { ru: 'Шаблоны', en: 'Templates' },
  pickTask: { ru: 'Задача из шаблона', en: 'Task from template' },
  none: { ru: 'Шаблонов нет', en: 'No templates' },
  saveTask: { ru: 'Сохранить как шаблон', en: 'Save as template' },
  name: { ru: 'Название шаблона', en: 'Template name' },
  save: { ru: 'Сохранить', en: 'Save' },
  cancel: { ru: 'Отмена', en: 'Cancel' },
  rename: { ru: 'Переименовать', en: 'Rename' },
  delete: { ru: 'Удалить', en: 'Delete' },
  deleteTitle: { ru: 'Удалить шаблон?', en: 'Delete template?' },
  taskKind: { ru: 'Задача', en: 'Task' },
  projectKind: { ru: 'Проект', en: 'Project' },
  createProject: { ru: 'Создать проект из шаблона', en: 'Create project from template' },
  projectName: { ru: 'Название проекта', en: 'Project name' },
  projectKey: { ru: 'Ключ (A–Z, 2–10)', en: 'Key (A–Z, 2–10)' },
  create: { ru: 'Создать', en: 'Create' },
  saveProject: { ru: 'Сохранить проект как шаблон', en: 'Save project as template' },
  project: { ru: 'Проект', en: 'Project' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
