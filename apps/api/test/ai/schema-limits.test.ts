import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { docResultSchema } from '../../../../modules/ai/api/doc-run.js';
import { resultSchema, UNION_LIMIT } from '../../../../modules/ai/api/run.js';

/** Union-typed parameters (anyOf or a type list) — what Anthropic structured outputs cap; as ai-sdk converts zod. */
function unions(schema: z.ZodType) {
  let n = 0;
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if ('anyOf' in o || Array.isArray(o.type)) n++;
    Object.values(o).forEach(walk);
  };
  walk(z.toJSONSchema(schema, { target: 'draft-7', io: 'input', reused: 'inline' }));
  return n;
}

describe('схемы ответа ИИ в пределах structured outputs', () => {
  it('задача и документ — не больше UNION_LIMIT объединений (иначе провайдер отвечает 400)', () => {
    expect(unions(resultSchema)).toBeLessThanOrEqual(UNION_LIMIT);
    expect(unions(docResultSchema())).toBeLessThanOrEqual(UNION_LIMIT);
  });
});
