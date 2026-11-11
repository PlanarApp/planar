import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, generateObject, generateText, type LanguageModel } from 'ai';
import type { z } from 'zod';
import type { AiProvider } from '../shared/index.js';

/** A connection with the decrypted key: lives only for one call, never stored or logged. */
export interface LlmConnection {
  provider: AiProvider;
  baseUrl: string | null;
  apiKey: string;
  model: string;
  /** USD per 1M tokens; null — cost is not counted */
  priceIn: number | null;
  priceOut: number | null;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** USD; null when the connection has no prices */
  cost: number | null;
}

export function modelOf(c: LlmConnection): LanguageModel {
  const baseURL = c.baseUrl ?? undefined;
  if (c.provider === 'anthropic') return createAnthropic({ apiKey: c.apiKey, baseURL })(c.model);
  const openai = createOpenAI({ apiKey: c.apiKey, baseURL });
  // OpenAI-compatible servers speak chat completions, not the Responses API
  return c.provider === 'openai' ? openai(c.model) : openai.chat(c.model);
}

export const costOf = (
  c: Pick<LlmConnection, 'priceIn' | 'priceOut'>,
  inT: number,
  outT: number,
) => (c.priceIn == null || c.priceOut == null ? null : (inT * c.priceIn + outT * c.priceOut) / 1e6);

/** Structured answer (`generateObject`) with the tokens and the cost of the call. */
export async function generateStructured<S extends z.ZodType>(
  c: LlmConnection,
  o: { schema: S; prompt: string; system?: string; maxOutputTokens?: number },
): Promise<{ object: z.output<S>; usage: LlmUsage }> {
  const r = await generateObject({
    model: modelOf(c),
    schema: o.schema,
    prompt: o.prompt,
    system: o.system,
    maxOutputTokens: o.maxOutputTokens,
    maxRetries: 1,
  });
  const inputTokens = r.usage.inputTokens ?? 0;
  const outputTokens = r.usage.outputTokens ?? 0;
  return {
    object: r.object as z.output<S>,
    usage: { inputTokens, outputTokens, cost: costOf(c, inputTokens, outputTokens) },
  };
}

export class ConnectionCheckFailed extends Error {
  constructor(
    /** 'rejected' — the provider refused the key; 'unavailable' — anything else */
    readonly kind: 'rejected' | 'unavailable',
  ) {
    super(kind);
  }
}

/** A test call on save: a few tokens. The provider's own error text is dropped (it may quote the key). */
export async function checkConnection(c: LlmConnection): Promise<void> {
  try {
    await generateText({ model: modelOf(c), prompt: 'ping', maxOutputTokens: 16, maxRetries: 0 });
  } catch (e) {
    const status = APICallError.isInstance(e) ? e.statusCode : undefined;
    throw new ConnectionCheckFailed(status === 401 || status === 403 ? 'rejected' : 'unavailable');
  }
}
