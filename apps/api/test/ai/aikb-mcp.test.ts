import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { toolDefs } from '../../src/mcp/tools.js';
import type { RestService } from '../../src/rest/rest.service.js';
import { mcpSection } from '../../../../modules/ai/api/aikb/mcp-section.js';

// toolDefs only captures `rest` in closures; metadata is readable without a database.
const defs = toolDefs({} as RestService);
const section = mcpSection(defs);
const names = defs.map((d) => d.name);
const listed = section.body
  .split('\n')
  .filter((l) => l.startsWith('- '))
  .map((l) => l.slice(2).split(' — ')[0]);

describe('aikb mcp section', () => {
  it('every registry tool is in the body', () => {
    for (const n of names) expect(listed).toContain(n);
  });
  it('no tool names outside the registry', () => {
    for (const n of listed) expect(names).toContain(n);
    expect(listed.length).toBe(names.length);
  });
  it('every tool has every argument and every enum value in its block', () => {
    const blocks = section.body.split(/\n(?=- )/);
    for (const d of defs) {
      const block = blocks.find((b) => b.startsWith(`- ${d.name} — `))!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON schema walked structurally
      const walk = (j: any) => {
        for (const v of j.enum ?? []) expect(block).toContain(JSON.stringify(v));
        for (const c of j.anyOf ?? []) walk(c);
        if (j.items) walk(j.items);
        for (const [k, v] of Object.entries(j.properties ?? {})) {
          expect(block).toContain(`${k}`);
          walk(v);
        }
      };
      walk(z.toJSONSchema(z.object(d.shape), { io: 'input', unrepresentable: 'any' }));
      expect(block).toMatch(d.write ? /\[write/ : /\[read/);
    }
  });
  it('shows filters of search_tasks', () => {
    expect(section.body).toMatch(/search_tasks[\s\S]*?Arguments:\n[\s\S]*?\n- /);
  });
});
