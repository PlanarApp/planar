import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { visibleSpace } from './spaces.service.js';
import { findTask } from './tasks.service.js';
import {
  capacities,
  entryRow,
  entryTask,
  estimateOf,
  ruleOf,
  timeReport,
  workloadOn,
} from './time.service.js';
import type { ExtArea, ExtOp } from './types.js';

// PLNRAPP-275 (time): time entries, estimates, report, workload capacity, recurring rules; rights — of the mutators
const id = z.uuid();
const task = z.string().min(1).describe('uuid или ключ задачи, например ABC-123');
const ts = z.iso.datetime();
const kind = z.enum(['interval', 'weekdays', 'after_done']);

/** the task with the data module on in its project */
async function taskWith(d: Parameters<ExtOp['run']>[0], u: string, ref: string, module: string) {
  const t = await findTask(d, u, ref);
  await d.moduleOn(u, module, t.projectId);
  return t;
}

const ops: ExtOp[] = [
  {
    tool: 'update_time_entry',
    description:
      'Изменить свою запись времени: начало, конец или длительность (сек), заметка, billable. У идущего таймера — только начало и заметка',
    method: 'patch',
    path: '/api/v1/time-entries/{id}',
    shape: {
      id,
      startedAt: ts.optional(),
      endedAt: ts.optional(),
      durationSec: z.number().int().min(0).max(86400).optional(),
      note: z.string().max(1000).nullable().optional(),
      billable: z.boolean().optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await entryTask(d, u, a.id);
      await d.run(u, [{ name: 'time.update', args: a }], t);
      return entryRow(d, a.id);
    },
  },
  {
    tool: 'delete_time_entry',
    description: 'Удалить свою запись времени',
    method: 'delete',
    path: '/api/v1/time-entries/{id}',
    shape: { id },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const a = i as { id: string };
      await entryTask(d, u, a.id);
      await d.run(u, [{ name: 'time.delete', args: a }], t);
    },
  },
  {
    tool: 'set_task_estimate',
    description: 'Оценка задачи в минутах (1–100000); minutes=null снимает оценку',
    method: 'put',
    path: '/api/v1/tasks/{task}/estimate',
    shape: { task, minutes: z.number().int().min(1).max(100000).nullable() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { task: string; minutes: number | null };
      const tk = await taskWith(d, u, a.task, 'time');
      await d.run(
        u,
        [{ name: 'time.setEstimate', args: { taskId: tk.id, minutes: a.minutes } }],
        t,
      );
      return { taskId: tk.id, estimate: await estimateOf(d, tk.id) };
    },
  },
  {
    tool: 'time_report',
    description:
      'Отчёт по времени проекта: сумма секунд (всего и billable) и число записей по пользователям или задачам за период',
    method: 'get',
    path: '/api/v1/time-report',
    shape: {
      projectId: id,
      groupBy: z.enum(['user', 'task']).default('user'),
      from: ts.optional(),
      to: ts.optional(),
    },
    write: false,
    run: async (d, u, i) => timeReport(d, u, i as Parameters<typeof timeReport>[2]),
  },
  {
    tool: 'get_workload',
    description:
      'Недельная ёмкость участников пространства в часах (hoursPerWeek; null — не задана)',
    method: 'get',
    path: '/api/v1/spaces/{id}/workload',
    shape: { id },
    write: false,
    run: async (d, u, i) => {
      const a = i as { id: string };
      await visibleSpace(d, u, a.id);
      await workloadOn(d, a.id);
      return capacities(d, a.id);
    },
  },
  {
    tool: 'set_workload_capacity',
    description:
      'Задать недельную ёмкость участника пространства в часах (0–168; нужна роль admin); hoursPerWeek=null снимает',
    method: 'put',
    path: '/api/v1/spaces/{id}/workload/{userId}',
    shape: { id, userId: id, hoursPerWeek: z.number().int().min(0).max(168).nullable() },
    write: true,
    run: async (d, u, i, t) => {
      const a = i as { id: string; userId: string; hoursPerWeek: number | null };
      await visibleSpace(d, u, a.id);
      await workloadOn(d, a.id);
      await d.run(
        u,
        [
          {
            name: 'workload.setCapacity',
            args: { id: uuidv7(), spaceId: a.id, userId: a.userId, hoursPerWeek: a.hoursPerWeek },
          },
        ],
        t,
      );
      return (await capacities(d, a.id)).find((m) => m.userId === a.userId);
    },
  },
  {
    tool: 'get_recurring',
    description: 'Правило повтора задачи или null',
    method: 'get',
    path: '/api/v1/tasks/{task}/recurring',
    shape: { task },
    write: false,
    run: async (d, u, i) =>
      ruleOf(d, (await taskWith(d, u, (i as { task: string }).task, 'recurring')).id),
  },
  {
    tool: 'set_recurring',
    description:
      'Задать (или заменить) повтор задачи: interval — каждые every day/week/month; weekdays — по дням недели (0=вс…6=сб, unit=week); after_done — через every после выполнения',
    method: 'put',
    path: '/api/v1/tasks/{task}/recurring',
    shape: {
      task,
      kind,
      every: z.number().int().min(1).max(365),
      unit: z.enum(['day', 'week', 'month']),
      weekdays: z.array(z.number().int().min(0).max(6)).default([]),
      timezone: z.string().min(1).default('UTC'),
      anchorDate: z.iso.date().optional(),
    },
    write: true,
    run: async (d, u, i, t) => {
      const { task: ref, ...rest } = i as { task: string } & Record<string, unknown>;
      const tk = await taskWith(d, u, ref, 'recurring');
      await d.run(
        u,
        [{ name: 'recurring.set', args: { id: uuidv7(), taskId: tk.id, ...rest } }],
        t,
      );
      return ruleOf(d, tk.id);
    },
  },
  {
    tool: 'remove_recurring',
    description: 'Снять повтор с задачи',
    method: 'delete',
    path: '/api/v1/tasks/{task}/recurring',
    shape: { task },
    write: true,
    danger: 'delete',
    status: 204,
    run: async (d, u, i, t) => {
      const tk = await taskWith(d, u, (i as { task: string }).task, 'recurring');
      await d.run(u, [{ name: 'recurring.remove', args: { taskId: tk.id } }], t);
    },
  },
];

export const area: ExtArea = { name: 'time', ops };
