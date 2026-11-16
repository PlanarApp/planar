import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { HttpError, type JobTool } from '@planar/server-kit';

/** The registry entry as the module gets it from `JobApi.tools` (a module does not import apps/api). */
export type ChatToolDef = JobTool & { dangerIf?: (args: never) => boolean };

/** `summary` — the text of the confirmation, when the args alone say too little (a batch: titles + changes) */
export type PlannedCall = { name: string; args: unknown; summary?: string };

/** The list for the user's «да»: the dryRun result (titles) and what changes. */
function batchSummary(name: string, args: unknown, preview: unknown): string {
  const p = preview as { matched?: { key: string | null; title: string }[] };
  const patch = JSON.stringify((args as { patch?: unknown }).patch);
  const list = (p.matched ?? []).map((t) => `  - ${t.key ?? ''} ${t.title}`).join('\n');
  return `${name}: ${p.matched?.length ?? 0} задач, изменения ${patch}\n${list}`;
}

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
          try {
            // a batch always waits for «да», once for the whole batch; dryRun changes nothing
            if (d.danger === 'bulk' && (args as { dryRun?: boolean }).dryRun !== true) {
              const preview = await d.run(
                { ...(args as object), dryRun: true } as never,
                initiatorId,
              );
              const summary = batchSummary(d.name, args, preview);
              planned.push({ name: d.name, args, summary });
              return { needsConfirmation: true, summary } satisfies NeedsConfirmation;
            }
            if (d.danger || d.dangerIf?.(args as never)) {
              planned.push({ name: d.name, args });
              return {
                needsConfirmation: true,
                summary: `${d.name} ${JSON.stringify(args)}`,
              } satisfies NeedsConfirmation;
            }
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
