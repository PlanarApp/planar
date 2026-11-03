import { Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import type { JobApi, JobDef, ModuleHookApi, MutationWrite } from '@planar/server-kit';
import { uuidv7, type BackendModuleManifest } from '@planar/shared';
import {
  addDays,
  afterDoneDue,
  duePeriod,
  nextOccurrence,
  shared,
  spanOf,
  todayIn,
  type Rule,
} from '../shared/index.js';

@Module({})
class RecurringModule {}

type Row = Record<string, unknown>;
/** Rule + template in one query; dates as text (pg returns date as Date). */
const RULE_SQL = sql`select r.id, r.kind, r.every, r.unit, r.weekdays, r.timezone, r.task_id,
  r.anchor_date::text as "anchorDate", r.next_date::text as "nextDate",
  t.start_date::text as "startDate", t.due_date::text as "dueDate"
  from recurring_rules r join tasks t on t.id = r.task_id
  join projects p on p.id = t.project_id and 'recurring' = any(p.modules)`;

interface Spawn {
  ruleId: string;
  period: string;
  /** the template at the moment of enqueueing */
  taskId?: string;
}

const spawn = async (data: Spawn, api: JobApi) => {
  const [r] = (await api.db.execute(sql`${RULE_SQL} where r.id = ${data.ruleId}`)).rows as Row[];
  if (!r) return;
  const sampleId = r.task_id as string;
  const done = r.kind === 'after_done';
  if (sampleId !== (data.taskId ?? (done ? data.period : sampleId))) return;
  const rule = r as unknown as Rule & { startDate: string | null; dueDate: string | null };
  const span = spanOf(rule);

  const [t] = (
    await api.db.execute(sql`select project_id, parent_id, title, description, priority, status_id,
      space_id, fields, completed_at from tasks where id = ${sampleId}`)
  ).rows as Row[];
  if (!t) return;
  const spaceId = t.space_id as string;
  const due = done
    ? afterDoneDue(
        rule,
        todayIn(rule.timezone, t.completed_at ? new Date(t.completed_at as string) : new Date()),
      )
    : data.period;
  const q = async (s: ReturnType<typeof sql>) => (await api.db.execute(s)).rows as Row[];
  const [status] = await q(sql`select id from statuses where project_id = ${t.project_id as string}
    and category in ('todo', 'backlog') order by (category = 'todo') desc, rank collate "C" limit 1`);
  const [last] = await q(sql`select rank from tasks where project_id = ${t.project_id as string}
    order by rank collate "C" desc limit 1`);
  const assignees = await q(sql`select a.user_id from task_assignees a
    join space_members s on s.space_id = ${spaceId} and s.user_id = a.user_id
    where a.task_id = ${sampleId}`);
  const labels = await q(sql`select label_id from task_labels where task_id = ${sampleId}`);
  const items = await q(sql`select text, rank from checklist_items where task_id = ${sampleId}`);

  const id = uuidv7();
  const fields = t.fields as Record<string, unknown>;
  const muts: { name: string; args: unknown }[] = [
    {
      name: 'task.create',
      args: {
        id,
        projectId: t.project_id,
        parentId: t.parent_id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        statusId: status?.id ?? t.status_id,
        rank: generateKeyBetween((last?.rank as string) ?? null, null),
        dueDate: due,
        startDate: rule.startDate && rule.dueDate ? addDays(due, -span) : null,
        assignees: assignees.map((a) => ({ id: uuidv7(), userId: a.user_id })),
        labels: labels.map((l) => ({ id: uuidv7(), labelId: l.label_id })),
      },
    },
    ...(Object.keys(fields).length ? [{ name: 'task.update', args: { id, fields } }] : []),
    ...items.map((i) => ({
      name: 'checklist.add',
      args: { id: uuidv7(), taskId: id, text: i.text, rank: i.rank },
    })),
    {
      name: 'recurring.advance',
      args: { id: rule.id, taskId: id, nextDate: done ? null : nextOccurrence(rule, data.period) },
    },
  ];
  await api.execute(api.systemUserId, muts, {
    system: true,
    async prepare(tx) {
      const locked = (
        await tx.execute(sql`select task_id from recurring_rules where id = ${rule.id} for update`)
      ).rows[0];
      if (locked?.task_id !== sampleId) return false;
      const ins = await tx.execute(sql`insert into recurring_runs (rule_id, period, task_id)
        values (${rule.id}, ${data.period}, ${id}) on conflict do nothing returning rule_id`);
      if (!ins.rows.length) return false;
    },
  });
};

const jobs: JobDef<never>[] = [
  {
    queue: 'recurring.tick',
    cron: '*/10 * * * *',
    async handler(_: unknown, api: JobApi) {
      const rows = (
        await api.db.execute(
          sql`${RULE_SQL} where r.kind <> 'after_done' and r.next_date is not null`,
        )
      ).rows as Row[];
      for (const r of rows) {
        let period: string | null;
        try {
          period = duePeriod(
            r as unknown as Rule,
            todayIn(r.timezone as string),
            spanOf(r as { startDate: string | null; dueDate: string | null }),
          );
        } catch {
          continue; // a broken zone must not stop the other rules
        }
        if (period)
          await api.enqueue(
            'recurring.spawn',
            { ruleId: r.id, period, taskId: r.task_id },
            { singletonKey: `${r.id}:${period}` },
          );
      }
    },
  },
  { queue: 'recurring.spawn', retryLimit: 3, retryDelay: 30, handler: spawn },
] as JobDef<never>[];

/** Completing a template after_done → an instance; deleting a task → the rule. */
async function afterMutation(writes: MutationWrite[], _ctx: unknown, api: ModuleHookApi) {
  const e = 'recurringRules' as never;
  const rulesOf = async (taskId: string) =>
    (await api.sys.scan(e, { index: 'taskId', eq: taskId })) as unknown as Rule[];
  for (const w of writes) {
    if (w.entity !== 'tasks') continue;
    if (w.op === 'del' && w.before) {
      for (const r of await rulesOf(w.before.id as string)) await api.sys.del(e, r.id);
    } else if (w.op === 'put' && w.before && !w.before.completedAt && w.after?.completedAt) {
      const taskId = w.after.id as string;
      const rule = (await rulesOf(taskId)).find((r) => r.kind === 'after_done');
      if (!rule) continue;
      const st = await api.sys.get('statuses', w.after.statusId as string);
      if (st?.category === 'done')
        await api.enqueue(
          'recurring.spawn',
          { ruleId: rule.id, period: taskId, taskId },
          { singletonKey: `${rule.id}:${taskId}` },
        );
    }
  }
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: RecurringModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs,
};
