import type { createTask, TaskView } from '../../tasks';

/** PLNRAPP-863: the data of a task list (TaskListView) — the project List passes its query, another screen — its own */
export interface TaskListSource {
  /** the tasks to show (with their subtasks); undefined — still loading */
  tasks: TaskView[] | undefined;
  /** quick creation of a task; none — createTask */
  create?: (args: Parameters<typeof createTask>[0]) => Promise<unknown>;
}
