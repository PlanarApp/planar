import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const goalsMilestones = pgTable(
  'goals_milestones',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    date: date({ mode: 'string' }).notNull(),
    description: text(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('goals_milestones_space_id_idx').on(t.spaceId),
    index('goals_milestones_project_id_idx').on(t.projectId),
  ],
);

export const goalsMilestoneTasks = pgTable(
  'goals_milestone_tasks',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    milestoneId: uuid().notNull(),
    taskId: uuid().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [
    index('goals_milestone_tasks_milestone_id_idx').on(t.milestoneId),
    uniqueIndex('goals_milestone_tasks_task_id_uq').on(t.taskId),
  ],
);

export const goalsGoals = pgTable(
  'goals_goals',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    ownerId: uuid(),
    dueDate: date({ mode: 'string' }),
    rank: text().notNull(),
    archivedAt: ts(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('goals_goals_space_id_idx').on(t.spaceId)],
);

export const goalsKeyResults = pgTable(
  'goals_key_results',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    goalId: uuid().notNull(),
    name: text().notNull(),
    kind: text({ enum: ['number', 'tasks'] }).notNull(),
    metric: jsonb(),
    filter: jsonb(),
    rank: text().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('goals_key_results_goal_id_idx').on(t.goalId)],
);
