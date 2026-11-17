import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  generateObject,
  generateText,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from 'ai';
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

/** The provider's text may quote the key (as in checkConnection): it is cut out before the error leaves here. */
function scrub(e: unknown, key: string): unknown {
  for (let x = e; x instanceof Error; x = x.cause)
    if (key) x.message = x.message.split(key).join('***');
  return e;
}

/** The run log line of a failed call: the error, the status and the provider's text — why the run failed. */
export function providerLog(e: unknown): string {
  if (!(e instanceof Error)) return 'провайдер: error';
  const status = APICallError.isInstance(e) ? ` ${e.statusCode ?? ''}` : '';
  const cause = e.cause instanceof Error ? ` (${e.cause.message})` : '';
  return `провайдер: ${e.name}${status} — ${(e.message + cause).replace(/\s+/g, ' ').slice(0, 1000)}`;
}

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
  }).catch((e: unknown) => {
    throw scrub(e, c.apiKey);
  });
  const inputTokens = r.usage.inputTokens ?? 0;
  const outputTokens = r.usage.outputTokens ?? 0;
  return {
    object: r.object as z.output<S>,
    usage: { inputTokens, outputTokens, cost: costOf(c, inputTokens, outputTokens) },
  };
}

/** Text answer (with tools: up to `maxSteps` steps of calls and results, or until `maxTokens` are spent in all steps) with the tokens and the cost of the call. */
export async function generateReply(
  c: LlmConnection,
  o: {
    prompt: string;
    system?: string;
    tools?: ToolSet;
    maxSteps?: number;
    maxTokens?: number;
  },
): Promise<{ text: string; usage: LlmUsage }> {
  const r = await generateText({
    model: modelOf(c),
    prompt: o.prompt,
    system: o.system,
    tools: o.tools,
    stopWhen: [
      stepCountIs(o.maxSteps ?? 5),
      ({ steps }) =>
        steps.reduce((n, s) => n + (s.usage.inputTokens ?? 0) + (s.usage.outputTokens ?? 0), 0) >=
        (o.maxTokens ?? Infinity),
    ],
    maxRetries: 1,
  }).catch((e: unknown) => {
    throw scrub(e, c.apiKey);
  });
  const inputTokens = r.totalUsage.inputTokens ?? 0;
  const outputTokens = r.totalUsage.outputTokens ?? 0;
  return {
    text: r.text,
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

/** PLNRAPP-189: model ids of the provider (`GET /models`, OpenAI and Anthropic answer `{data: [{id}]}`), sorted. */
export async function listModels(c: Pick<LlmConnection, 'provider' | 'baseUrl' | 'apiKey'>) {
  const anthropic = c.provider === 'anthropic';
  const base = (
    c.baseUrl ?? (anthropic ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')
  ).replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/models${anthropic ? '?limit=1000' : ''}`, {
      headers: anthropic
        ? { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }
        : { authorization: `Bearer ${c.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ConnectionCheckFailed('unavailable');
  }
  if (!res.ok)
    throw new ConnectionCheckFailed(
      res.status === 401 || res.status === 403 ? 'rejected' : 'unavailable',
    );
  const body = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
  return [
    ...new Set(
      (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string'),
    ),
  ].sort();
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
