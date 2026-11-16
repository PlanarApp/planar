import { describe, expect, it } from 'vitest';
import { actionSchema, triggerSchema } from '@planar/module-automations/shared';
import { NO_DESC, section } from '../../../../modules/ai/api/aikb/sections/automations.js';
import { toolDefs } from '../../src/mcp/tools.js';
import type { RestService } from '../../src/rest/rest.service.js';

const types = (s: unknown) =>
  (s as { options: { shape: { type: { def: { values: string[] } } } }[] }).options.map(
    (o) => o.shape.type.def.values[0]!,
  );
const lineOf = (t: string) =>
  section.body.split('\n').find((l) => l.startsWith(`- ${t} `) || l.startsWith(`- ${t} (`));

describe('aikb automations section', () => {
  it.each([...types(triggerSchema), ...types(actionSchema)])('type %s is described', (t) => {
    const l = lineOf(t);
    expect(l).toBeTruthy();
    expect(l).not.toContain(NO_DESC);
  });
  it('mentions only existing MCP tools', () => {
    const names = toolDefs({} as RestService).map((d) => d.name);
    for (const m of section.body.matchAll(/^- ([a-z_]+_automations?) /gm))
      expect(names).toContain(m[1]);
    for (const n of [
      'list_automations',
      'create_automation',
      'update_automation',
      'delete_automation',
    ])
      expect(names).toContain(n);
  });
});
