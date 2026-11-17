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

/** Always sent: Planar's knowledge and docs, the harness packs, the basic reads. */
export const BASE_TOOLS = [
  'ai_kb',
  'search_docs_site',
  'ai_list_packs',
  'ai_diff_pack',
  'ai_upload_pack',
  'ai_apply_pack',
  'ai_set_pack_events',
  'search_tasks',
  'get_task',
  'list_projects',
  'project_dictionary',
  'list_docs',
  'get_doc',
];
export const FIND_TOOLS = 'find_tools';

/**
 * PLNRAPP-449: the model gets the base tools and only the names of the rest (in find_tools' description); a tool's
 * schema goes to the provider once the model enables it — not all ~200 schemas (~50k tokens) on every step.
 * `active` only grows: a tool called earlier stays in the request (Anthropic wants the tools of the history).
 */
export function lazyTools(tools: ToolSet): { tools: ToolSet; active: Set<string> } {
  const active = new Set([...BASE_TOOLS.filter((n) => n in tools), FIND_TOOLS]);
  const rest = Object.keys(tools).filter((n) => !active.has(n));
  const find = tool({
    description: `Подключить инструменты трекера по именам: их схемы придут на следующем шаге. Остальные инструменты: ${rest.join(', ')}`,
    inputSchema: z.object({ names: z.array(z.string()).min(1).max(20) }),
    execute: async ({ names }: { names: string[] }) => {
      const known = names.filter((n) => n in tools);
      for (const n of known) active.add(n);
      return {
        enabled: known.map((n) => ({ name: n, description: tools[n]!.description })),
        unknown: names.filter((n) => !(n in tools)),
      };
    },
  });
  return { tools: { ...tools, [FIND_TOOLS]: find }, active };
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
