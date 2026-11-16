import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { eq } from 'drizzle-orm';
import type { ExtArea, ExtDeps, ExtOp } from './types.js';
import {
  cols,
  goalsOf,
  lastRank,
  projectRowOf,
  spaceRowOf,
  visibleSpaceOf,
  wireRow,
  wireRows,
} from './planning.service.js';
import { findTask } from './tasks.service.js';

// PLNRAPP-275 (part 1): cycles, goals, key results and milestones over the existing mutators; rights — of the mutators
const id = z.uuid();
const date = z.iso.date();
const task = z.string().min(1).describe('uuid или ключ задачи, например ABC-123');
const metric = z.object({
  start: z.number(),
  target: z.number(),
  current: z.number(),
  unit: z.string().max(20).nullable(),
});
const krFilter = z.object({
  projectIds: z.array(id),
  filter: z.object({
    op: z.enum(['and', 'or']),
    rules: z.array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z
          .union([z.array(z.string()), z.array(z.number()), z.string(), z.number()])
          .optional(),
      }),
    ),
  }),
});
const desc = z.string().max(5000).nullable().optional();

/** a cycle / milestone of a visible project with the module on, else 404 */
const cycleRow = (d: ExtDeps, u: string, cid: string) =>
  projectRowOf(d, u, 'sprintsCycles', 'sprints', cid, 'Цикл');
const milestoneRow = (d: ExtDeps, u: string, mid: string) =>
  projectRowOf(d, u, 'goalsMilestones', 'goals', mid, 'Веха');

const ops: ExtOp[] = [
  {
    tool: 'configure_sprints',
    description:
      'Настроить циклы проекта: включить/выключить, длина цикла в днях, часовой пояс, автосоздание следующего',
    method: 'put',
    path: '/api/v1/projects/{id}/sprints/settings',
    shape: {
      id,
      enabled: z.boolean().optional(),
      lengthDays: z.number().int().min(1).max(60).optional(),
      timezone: z.string().min(1).optional(),
      autoCreate: z.boolean().optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const { id: pid, ...rest } = i as { id: string };
      await d.visibleProject(u, pid);
      await d.moduleOn(u, 'sprints', pid);
      await d.run(u, [{ name: 'sprints.configure', args: { projectId: pid, ...rest } }], t);
      return wireRow(d, 'sprintsSettings', pid);
    },
  },
  {
    tool: 'create_sprint',
    description:
      'Создать цикл в проекте: дата начала, конец (по умолчанию по длине цикла), название; циклы не пересекаются',
    method: 'post',
    path: '/api/v1/projects/{id}/cycles',
    shape: { id, startDate: date, endDate: date.optional(), name: z.string().max(100).optional() },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: pid, ...rest } = i as { id: string };
      await d.visibleProject(u, pid);
      await d.moduleOn(u, 'sprints', pid);
      const cid = uuidv7();
      await d.run(u, [{ name: 'sprints.create', args: { id: cid, projectId: pid, ...rest } }], t);
      return wireRow(d, 'sprintsCycles', cid);
    },
  },
  {
    tool: 'update_sprint',
    description: 'Изменить цикл: название, даты (закрытый цикл не меняется)',
    method: 'patch',
    path: '/api/v1/cycles/{id}',
    shape: {
      id,
      name: z.string().max(100).nullable().optional(),
      startDate: date.optional(),
      endDate: date.optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await cycleRow(d, u, a.id);
      await d.run(u, [{ name: 'sprints.update', args: a }], t);
      return wireRow(d, 'sprintsCycles', a.id);
    },
  },
  {
    tool: 'delete_sprint',
    description: 'Удалить цикл (его задачи остаются без цикла)',
    method: 'delete',
    path: '/api/v1/cycles/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await cycleRow(d, u, a.id);
      await d.run(u, [{ name: 'sprints.delete', args: a }], t);
    },
  },
  {
    tool: 'close_sprint',
    description:
      'Закрыть цикл: незавершённые задачи переходят в следующий (при автосоздании он создаётся)',
    method: 'post',
    path: '/api/v1/cycles/{id}/close',
    shape: { id },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await cycleRow(d, u, a.id);
      await d.run(u, [{ name: 'sprints.close', args: { id: a.id, nextId: uuidv7() } }], t);
      return wireRow(d, 'sprintsCycles', a.id);
    },
  },
  {
    tool: 'set_task_sprint',
    description: 'Поставить задачу в цикл своего проекта; cycleId=null — убрать из цикла',
    method: 'put',
    path: '/api/v1/tasks/{task}/cycle',
    shape: { task, cycleId: id.nullable() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { task: string; cycleId: string | null };
      const tk = await findTask(d, u, a.task);
      await d.moduleOn(u, 'sprints', tk.projectId);
      await d.run(u, [{ name: 'sprints.setTask', args: { taskId: tk.id, cycleId: a.cycleId } }], t);
      return { id: tk.id, cycleId: a.cycleId };
    },
  },
  {
    tool: 'list_goals',
    description:
      'Цели пространства с ключевыми результатами (KR: number — метрика, tasks — фильтр задач); archived=true — и архивные',
    method: 'get',
    path: '/api/v1/spaces/{id}/goals',
    shape: { id, archived: z.union([z.boolean(), z.stringbool()]).optional() },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string; archived?: boolean };
      await visibleSpaceOf(d, u, a.id, 'Пространство');
      return goalsOf(d, a.id, !!a.archived);
    },
  },
  {
    tool: 'create_goal',
    description: 'Создать цель в пространстве: название, описание, ответственный (участник), срок',
    method: 'post',
    path: '/api/v1/spaces/{id}/goals',
    shape: {
      id,
      name: z.string().min(1).max(200),
      description: desc,
      ownerId: id.nullable().optional(),
      dueDate: date.nullable().optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: sid, ...rest } = i as { id: string };
      await visibleSpaceOf(d, u, sid, 'Пространство');
      const gid = uuidv7();
      const g = cols('goalsGoals');
      const rank = await lastRank(d, 'goalsGoals', eq(g.spaceId!, sid));
      await d.run(
        u,
        [{ name: 'goals.goal.create', args: { id: gid, spaceId: sid, rank, ...rest } }],
        t,
      );
      return wireRow(d, 'goalsGoals', gid);
    },
  },
  {
    tool: 'update_goal',
    description:
      'Изменить цель: название, описание, ответственный, срок; archived=true/false — в архив и обратно',
    method: 'patch',
    path: '/api/v1/goals/{id}',
    shape: {
      id,
      name: z.string().min(1).max(200).optional(),
      description: desc,
      ownerId: id.nullable().optional(),
      dueDate: date.nullable().optional(),
      archived: z.boolean().optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const { archived, ...a } = i as { id: string; archived?: boolean };
      await spaceRowOf(d, u, 'goalsGoals', a.id, 'Цель');
      const args =
        archived === undefined
          ? a
          : { ...a, archivedAt: archived ? new Date().toISOString() : null };
      await d.run(u, [{ name: 'goals.goal.update', args }], t);
      return wireRow(d, 'goalsGoals', a.id);
    },
  },
  {
    tool: 'delete_goal',
    description: 'Удалить цель вместе с её ключевыми результатами (необратимо; обратимо — архивом)',
    method: 'delete',
    path: '/api/v1/goals/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await spaceRowOf(d, u, 'goalsGoals', a.id, 'Цель');
      await d.run(u, [{ name: 'goals.goal.delete', args: a }], t);
    },
  },
  {
    tool: 'create_key_result',
    description:
      'Добавить KR к цели: kind=number требует metric (start, target, current, unit), kind=tasks — filter (projectIds и правила)',
    method: 'post',
    path: '/api/v1/goals/{id}/key-results',
    shape: {
      id,
      name: z.string().min(1).max(200),
      kind: z.enum(['number', 'tasks']),
      metric: metric.nullable().optional(),
      filter: krFilter.nullable().optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: gid, ...rest } = i as { id: string };
      await spaceRowOf(d, u, 'goalsGoals', gid, 'Цель');
      const kid = uuidv7();
      const k = cols('goalsKeyResults');
      const rank = await lastRank(d, 'goalsKeyResults', eq(k.goalId!, gid));
      await d.run(
        u,
        [{ name: 'goals.kr.create', args: { id: kid, goalId: gid, rank, ...rest } }],
        t,
      );
      return wireRow(d, 'goalsKeyResults', kid);
    },
  },
  {
    tool: 'update_key_result',
    description:
      'Изменить KR: название; metric (для number, в т. ч. current) или filter (для tasks)',
    method: 'patch',
    path: '/api/v1/key-results/{id}',
    shape: {
      id,
      name: z.string().min(1).max(200).optional(),
      metric: metric.optional(),
      filter: krFilter.optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await spaceRowOf(d, u, 'goalsKeyResults', a.id, 'KR');
      await d.run(u, [{ name: 'goals.kr.update', args: a }], t);
      return wireRow(d, 'goalsKeyResults', a.id);
    },
  },
  {
    tool: 'delete_key_result',
    description: 'Удалить ключевой результат цели',
    method: 'delete',
    path: '/api/v1/key-results/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await spaceRowOf(d, u, 'goalsKeyResults', a.id, 'KR');
      await d.run(u, [{ name: 'goals.kr.delete', args: a }], t);
    },
  },
  {
    tool: 'list_milestones',
    description: 'Вехи проекта: название, дата, описание, id задач в вехе',
    method: 'get',
    path: '/api/v1/projects/{id}/milestones',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string };
      await d.visibleProject(u, a.id);
      await d.moduleOn(u, 'goals', a.id);
      const m = cols('goalsMilestones');
      const ms = await wireRows(d, 'goalsMilestones', eq(m.projectId!, a.id), [m.date!, m.id!]);
      const mt = cols('goalsMilestoneTasks');
      const sp = ms[0]?.spaceId as string | undefined;
      const links = sp
        ? await wireRows(d, 'goalsMilestoneTasks', eq(mt.spaceId!, sp), [mt.id!])
        : [];
      return ms.map((x) => ({
        ...x,
        taskIds: links.filter((l) => l.milestoneId === x.id).map((l) => l.taskId),
      }));
    },
  },
  {
    tool: 'create_milestone',
    description: 'Создать веху проекта: название, дата, описание',
    method: 'post',
    path: '/api/v1/projects/{id}/milestones',
    shape: {
      id,
      name: z.string().min(1).max(200),
      date,
      description: z.string().max(2000).optional(),
    },
    write: true,
    status: 201,
    run: async (d, u, i, t) => {
      const { id: pid, ...rest } = i as { id: string };
      await d.visibleProject(u, pid);
      await d.moduleOn(u, 'goals', pid);
      const mid = uuidv7();
      await d.run(
        u,
        [{ name: 'goals.milestone.create', args: { id: mid, projectId: pid, ...rest } }],
        t,
      );
      return wireRow(d, 'goalsMilestones', mid);
    },
  },
  {
    tool: 'update_milestone',
    description: 'Изменить веху: название, дата, описание',
    method: 'patch',
    path: '/api/v1/milestones/{id}',
    shape: {
      id,
      name: z.string().min(1).max(200).optional(),
      date: date.optional(),
      description: z.string().max(2000).nullable().optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await milestoneRow(d, u, a.id);
      await d.run(u, [{ name: 'goals.milestone.update', args: a }], t);
      return wireRow(d, 'goalsMilestones', a.id);
    },
  },
  {
    tool: 'delete_milestone',
    description: 'Удалить веху (задачи остаются, привязка снимается)',
    method: 'delete',
    path: '/api/v1/milestones/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await milestoneRow(d, u, a.id);
      await d.run(u, [{ name: 'goals.milestone.delete', args: a }], t);
    },
  },
  {
    tool: 'set_task_milestone',
    description: 'Привязать задачу к вехе её проекта; milestoneId=null — снять с вехи',
    method: 'put',
    path: '/api/v1/tasks/{task}/milestone',
    shape: { task, milestoneId: id.nullable() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { task: string; milestoneId: string | null };
      const tk = await findTask(d, u, a.task);
      await d.moduleOn(u, 'goals', tk.projectId);
      if (a.milestoneId) await milestoneRow(d, u, a.milestoneId);
      await d.run(
        u,
        [
          {
            name: 'goals.milestone.setTask',
            args: { id: uuidv7(), taskId: tk.id, milestoneId: a.milestoneId },
          },
        ],
        t,
      );
      return { id: tk.id, milestoneId: a.milestoneId };
    },
  },
];

export const area: ExtArea = { name: 'planning', ops };
