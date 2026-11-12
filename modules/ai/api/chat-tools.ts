import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { HttpError, type JobTool } from '@planar/server-kit';

/** A call that changes more tasks than this needs confirmation (no such tool in the registry yet). */
export const CHAT_BULK_LIMIT = 5;

/** The registry entry as the module gets it from `JobApi.tools` (a module does not import apps/api). */
export type ChatToolDef = JobTool;

export type PlannedCall = { name: string; args: unknown };

/** Result of a dangerous tool: not executed, the call is kept in `planned`, the chat asks the user first. */
export interface NeedsConfirmation {
  needsConfirmation: true;
  summary: string;
}

/**
 * AI SDK tools from the registry. Calls go only as `initiatorId` (rights are RestService's): the defs must be
 * built from a RestService with the run's origin, `api.tools({ aiRunId, depth: 0 })`.
 * A refusal (HttpError) is a result for the model, not an exception.
 */
export function chatTools(
  defs: ChatToolDef[],
  initiatorId: string,
  planned: PlannedCall[] = [],
): ToolSet {
  return Object.fromEntries(
    defs.map((d) => [
      d.name,
      tool({
        description: d.description,
        inputSchema: z.object(d.shape),
        execute: async (args: unknown): Promise<unknown> => {
          if (d.danger) {
            planned.push({ name: d.name, args });
            return {
              needsConfirmation: true,
              summary: `${d.name} ${JSON.stringify(args)}`,
            } satisfies NeedsConfirmation;
          }
          try {
            return await d.run(args as never, initiatorId);
          } catch (e) {
            if (e instanceof HttpError) return { error: e.code, message: e.message };
            throw e;
          }
        },
      }),
    ]),
  );
}

/** The calls the initiator confirmed: again only as the initiator (rights are RestService's); one line of result per call. */
export async function runPlanned(
  defs: ChatToolDef[],
  initiatorId: string,
  calls: PlannedCall[],
): Promise<string[]> {
  const out: string[] = [];
  for (const c of calls) {
    const d = defs.find((x) => x.name === c.name);
    try {
      if (!d) throw new HttpError(404, 'not_found', 'инструмент недоступен');
      await d.run(z.object(d.shape).parse(c.args) as never, initiatorId);
      out.push(`Выполнено: ${c.name}`);
    } catch (e) {
      out.push(`Не выполнено: ${c.name} — ${e instanceof HttpError ? e.message : 'ошибка'}`);
    }
  }
  return out;
}
