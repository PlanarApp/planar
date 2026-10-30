import { uuidv7, ranks } from '../lib.js';
import type { Fixture } from './helpers.js';

const pad = (n: number) => String(n).padStart(2, '0');
/** Current local month's day: YYYY-MM-DD. */
export const dayOfMonth = (n: number): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(n)}`;
};

/** Current state of the task on the server (from bootstrap). */
export async function serverTask(f: Fixture, id: string): Promise<Record<string, unknown>> {
  const { data } = await f.admin.bootstrap();
  return data.tasks!.find((t) => t.id === id)!;
}

/** Project field definition; returns its id. */
export async function addField(
  f: Fixture,
  name: string,
  type: string,
  options?: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  await f.admin.pushOk([
    f.admin.mut('field.create', {
      id,
      projectId: f.projectId,
      name,
      type,
      ...(options && { options }),
      rank: ranks(1)[0],
    }),
  ]);
  return id;
}

/** Number of links of the fixture space on the server. */
export async function serverLinks(f: Fixture): Promise<number> {
  const { data } = await f.admin.bootstrap();
  return (data.taskLinks ?? []).filter((l) => f.taskIds.includes(l.taskId as string)).length;
}
