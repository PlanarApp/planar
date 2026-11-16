import { section as automations } from './sections/automations.js';
import { section as entities } from './sections/entities.js';
import { section as permissions } from './sections/permissions.js';
import { section as recipes } from './sections/recipes.js';
import { section as runs } from './sections/runs.js';
import { section as viewsSettings } from './sections/views-settings.js';
import { mcpSection, type McpToolMeta } from './mcp-section.js';
import { core as coreBlock } from './core.js';

export type Section = { id: string; title: string; body: string };
export type { McpToolMeta };

/** Static sections plus the mcp section built from the registry (`defs`). */
export const aikbSections = (defs: McpToolMeta[]): Section[] => [
  entities,
  runs,
  automations,
  viewsSettings,
  permissions,
  recipes,
  mcpSection(defs),
];

/** The common block with the section ids listed. */
export const core = (publicUrl: string, sections: Section[] = aikbSections([])): string =>
  coreBlock(
    publicUrl,
    sections.map((s) => s.id),
  );

/** Without id: the list «id — title»; with id: the body. Unknown id — an error with the list. */
export function detail(sections: Section[], id?: string): string {
  const list = sections.map((s) => `${s.id} — ${s.title}`).join('\n');
  if (!id) return list;
  const s = sections.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown section "${id}". Sections:\n${list}`);
  return s.body;
}
