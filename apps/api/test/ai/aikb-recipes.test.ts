import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CoreServices } from '@planar/server-kit';
import { toolDefs } from '../../src/mcp/tools.js';
import { batchDefs } from '../../src/mcp/tools-batch.js';
import { settingsDefs } from '../../src/mcp/tools-settings.js';
import type { RestService } from '../../src/rest/rest.service.js';
import { aiPackTools } from '../../../../modules/ai/api/pack-tools.js';
import { section } from '../../../../modules/ai/api/aikb/sections/recipes.js';

const rest = {} as RestService;
const all = [
  ...toolDefs(rest),
  ...batchDefs(rest),
  ...settingsDefs(rest),
  ...aiPackTools({} as CoreServices),
];
const keys = new Map(all.map((d) => [d.name, new Set(Object.keys(z.object(d.shape).shape))]));
const recipes = section.body.split(/\n(?=### )/).slice(1);
const calls = (text: string) => [...text.matchAll(/`([a-z]+(?:_[a-z]+)*)\(([^)`]*)\)`/g)];

describe('aikb recipes section', () => {
  it('has 8-12 recipes, each with calls', () => {
    expect(recipes.length).toBeGreaterThanOrEqual(8);
    expect(recipes.length).toBeLessThanOrEqual(12);
    for (const r of recipes) expect(calls(r).length, r.split('\n')[0]).toBeGreaterThan(0);
  });
  it('every called tool exists and its arguments are real keys of its shape', () => {
    for (const m of calls(section.body)) {
      const [, name, args] = m;
      expect(keys.has(name!), name).toBe(true);
      for (const a of args!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean))
        expect(keys.get(name!)!.has(a), `${name}(${a})`).toBe(true);
    }
  });
  it('every backticked snake_case token outside calls is a tool', () => {
    const rest2 = section.body.replace(/`[a-z_]+\([^)`]*\)`/g, '');
    for (const m of rest2.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g))
      expect(keys.has(m[1]!), m[1]).toBe(true);
  });
});
