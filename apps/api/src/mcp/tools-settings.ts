import { z } from 'zod';
import type { RestService } from '../rest/rest.service.js';
import { SETTING_OPS, setModuleSchema } from '../rest/settings.js';
import type { ToolDef } from './tools.js';

/**
 * Project settings tools (PLNRAPP-266): statuses, labels, fields, automations, AI actions, project, modules.
 * All write and `danger` — a change of settings in the chat needs the user's «yes» (CA-5 maps this to
 * needsConfirmation; ToolDanger is deliberately not extended here).
 */
export function settingsDefs(rest: RestService): ToolDef[] {
  const base = { write: true, danger: 'delete' } as const;
  const defs: ToolDef[] = SETTING_OPS.map((o) => ({
    ...base,
    name: o.tool,
    description: o.description,
    shape: o.schema.shape,
    run: async (a, uid, tokenId) =>
      (await rest.setting(uid, o.mutator, a, tokenId)).data ?? { ok: true },
  }));
  defs.push(
    {
      ...base,
      name: 'set_project_module',
      description: 'Включить или выключить модуль данных проекта (зависимые модули — вместе)',
      shape: setModuleSchema.shape,
      run: async (a, uid, tokenId) => (await rest.setModule(uid, a, tokenId)).data,
    },
    {
      name: 'list_ai_actions',
      description: 'ИИ-действия проекта',
      shape: { projectId: z.uuid() },
      write: false,
      run: async (a: { projectId: string }, uid) => (await rest.aiActions(uid, a.projectId)).data,
    },
  );
  return defs;
}
