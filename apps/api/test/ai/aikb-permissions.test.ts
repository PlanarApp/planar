import { describe, expect, it } from 'vitest';
import type { CoreServices } from '@planar/server-kit';
import { toolDefs } from '../../src/mcp/tools.js';
import { batchDefs } from '../../src/mcp/tools-batch.js';
import { settingsDefs } from '../../src/mcp/tools-settings.js';
import type { RestService } from '../../src/rest/rest.service.js';
import { aiPackTools } from '../../../../modules/ai/api/pack-tools.js';
import { section } from '../../../../modules/ai/api/aikb/sections/permissions.js';

const rest = {} as RestService;
const all = [
  ...toolDefs(rest),
  ...batchDefs(rest),
  ...settingsDefs(rest),
  ...aiPackTools({} as CoreServices),
];
const defs = [...new Map(all.map((d) => [d.name, d])).values()];
const group = (h: RegExp) =>
  section.body.split(/\n(?=## )/).find((g) => h.test(g.split('\n')[0]!)) ?? '';
const tools = (g: string) => [...g.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!);

describe('aikb permissions section', () => {
  const danger = group(/danger\)/);
  const dangerIf = group(/dangerIf/);
  const writes = group(/Writes without/);
  const readOnly = group(/Read-only/);
  const admin = group(/Admin only/);

  it('every danger tool is in the yes group', () => {
    const d = defs as { name: string; danger?: string }[];
    for (const t of d.filter((x) => x.danger)) expect(danger).toContain(`\`${t.name}\``);
  });
  it('every dangerIf tool is named in its group', () => {
    const d = defs as { name: string; dangerIf?: unknown }[];
    for (const t of d.filter((x) => x.dangerIf)) expect(dangerIf).toContain(`\`${t.name}\``);
  });
  it('every other write tool is in the no-yes group or admin group', () => {
    const d = defs as { name: string; write?: boolean; danger?: string; dangerIf?: unknown }[];
    for (const t of d.filter((x) => x.write && !x.danger && !x.dangerIf)) {
      expect(writes + admin).toContain(`\`${t.name}\``);
    }
  });
  it('every read tool is in the read-only group or admin group', () => {
    const d = defs as { name: string; write?: boolean }[];
    for (const t of d.filter((x) => !x.write)) expect(readOnly + admin).toContain(`\`${t.name}\``);
  });
  it('names only tools of the registry', () => {
    const names = defs.map((d) => d.name);
    for (const n of tools(section.body)) {
      if (n === 'ai_run') continue; // an automation action type
      expect(names).toContain(n);
    }
  });
  it('states the gaps', () => {
    expect(section.body).toContain('Not available via MCP');
    expect(section.body).toContain('admin of the project');
  });
});
