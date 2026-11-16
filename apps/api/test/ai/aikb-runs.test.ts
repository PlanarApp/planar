import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resultSchema } from '../../../../modules/ai/api/run.js';
import { section, PACK_ACTIONS } from '../../../../modules/ai/api/aikb/sections/runs.js';
import { parseHarnessYaml } from '../../../../modules/ai/shared/harness.js';

describe('aikb runs section', () => {
  it('has every resultSchema field', () => {
    for (const k of Object.keys(z.toJSONSchema(resultSchema).properties ?? {}))
      expect(section.body).toContain(`- ${k}:`);
  });
  it.each(['dev', 'hiring', 'sales', 'support'])('pack %s actions match harness.yml', (p) => {
    const yml = readFileSync(
      new URL(`../../../../modules/ai/harnesses/${p}/harness.yml`, import.meta.url),
      'utf8',
    );
    const actions = parseHarnessYaml(yml).actions;
    expect([...PACK_ACTIONS[p]!].sort()).toEqual([...actions].sort());
    expect(section.body).toContain(`- ${p}: ${PACK_ACTIONS[p]!.join(', ')}`);
  });
});
