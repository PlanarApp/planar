import { describe, expect, it } from 'vitest';
import type { CoreServices } from '@planar/server-kit';
import { appUrl, type AppTarget } from '@planar/shared';
import { toolDefs } from '../../src/mcp/tools.js';
import { kbTool } from '../../src/mcp/tools-kb.js';
import type { RestService } from '../../src/rest/rest.service.js';
import { aikbSections, core, detail } from '../../../../modules/ai/api/aikb/index.js';
import { URL_TARGETS } from '../../../../modules/ai/api/aikb/core.js';
import { aiPackTools } from '../../../../modules/ai/api/pack-tools.js';

const BASE = 'https://x.example';
const defs = [...toolDefs({} as RestService), ...aiPackTools({} as CoreServices)];
const kb = kbTool(defs);
defs.push(kb);
const sections = aikbSections(defs);
const block = core(BASE, sections);

describe('aikb core block', () => {
  it('has the URL of every AppTarget kind', () => {
    const kinds: AppTarget['kind'][] = [
      'task',
      'doc',
      'chat',
      'taskChat',
      'docChat',
      'project',
      'space',
      'section',
      'comment',
    ];
    for (const k of kinds) expect(URL_TARGETS.some(([, t]) => t.kind === k)).toBe(true);
    for (const [, t] of URL_TARGETS) expect(block).toContain(appUrl(BASE, t));
    expect(block).not.toMatch(/planarhq\.com/);
    expect(core(`${BASE}//`, sections)).toBe(block);
  });
  it('fits 1500 tokens (chars / 4)', () => {
    console.log('core chars', block.length, 'tokens ~', Math.ceil(block.length / 4));
    expect(block.length / 4).toBeLessThanOrEqual(1500);
  });
  it('names every section id', () => {
    for (const s of sections) expect(block).toContain(s.id);
  });
  it('detail: list, body, unknown id', () => {
    const list = detail(sections);
    for (const s of sections) expect(list).toContain(`${s.id} — ${s.title}`);
    for (const s of sections) expect(detail(sections, s.id)).toBe(s.body);
    expect(() => detail(sections, 'nope')).toThrow(/entities/);
  });
  it('mcp section mentions every registry tool, ai_kb included', () => {
    const body = detail(sections, 'mcp');
    for (const d of defs) expect(body).toContain(`- ${d.name} — `);
    expect(defs.map((d) => d.name)).toContain('ai_kb');
  });
});
