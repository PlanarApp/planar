import { z } from 'zod';
import { aikbSections, detail, type McpToolMeta } from '@planar/module-ai/api';
import { HttpError } from '../auth/errors.js';
import type { ToolDef } from './tools.js';

/** ai_kb: knowledge sections about the instance; `defs` feed the mcp section (the registry itself plus ai_kb). */
export function kbTool(
  defs: McpToolMeta[],
): Pick<ToolDef, 'name' | 'description' | 'shape' | 'write' | 'run'> {
  return {
    name: 'ai_kb',
    description:
      'Planar knowledge base: without section — the list of sections (id — title), with section — its text',
    shape: { section: z.string().optional() },
    write: false,
    run: async (a: { section?: string }) => {
      try {
        return detail(aikbSections(defs), a.section);
      } catch (e) {
        throw new HttpError(404, 'not_found', (e as Error).message);
      }
    },
  };
}
