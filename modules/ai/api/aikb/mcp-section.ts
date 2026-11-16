import { z } from 'zod';

/** Structural view of a registry tool (apps/api/src/mcp/tools.ts); no import from apps/api (rootDir). */
export type McpToolMeta = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  write?: boolean;
  danger?: string;
  dangerIf?: unknown;
};

type J = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: J[];
  items?: J;
  properties?: Record<string, J>;
  required?: string[];
  additionalProperties?: boolean | J;
  description?: string;
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
};

const firstSentence = (s: string) => s.split(/(?<=[.!?])\s/)[0]!.trim();

/** Type of a JSON-schema node: enum values, array item type, object keys (nested, * = required). */
function typeOf(j: J): string {
  if (j.enum) return `enum(${j.enum.map((v) => JSON.stringify(v)).join('|')})`;
  if (j.const !== undefined) return `const ${JSON.stringify(j.const)}`;
  if (j.anyOf) return [...new Set(j.anyOf.map(typeOf))].join(' | ');
  const t = Array.isArray(j.type) ? j.type.join('|') : (j.type ?? 'any');
  if (t === 'array') return `array<${j.items ? typeOf(j.items) : 'any'}>`;
  if (t === 'object') {
    const props = Object.entries(j.properties ?? {}).map(
      ([k, v]) => `${k}${j.required?.includes(k) ? '*' : ''}: ${typeOf(v)}`,
    );
    const rest =
      j.additionalProperties && typeof j.additionalProperties === 'object'
        ? [`[key]: ${typeOf(j.additionalProperties)}`]
        : [];
    return `{${[...props, ...rest].join('; ')}}`;
  }
  return t + (j.format === 'uuid' ? ' (uuid: id reference)' : j.format ? ` (${j.format})` : '');
}

const limits = (j: J) =>
  (['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'] as const)
    .filter((k) => j[k] !== undefined)
    .map((k) => `${k}=${j[k]}`);

/** Argument lines: name[*]: type; default; limits; description. */
function args(d: McpToolMeta): string[] {
  const js = z.toJSONSchema(z.object(d.shape), { io: 'input', unrepresentable: 'any' }) as J;
  return Object.entries(js.properties ?? {}).map(([k, v]) => {
    const parts = [
      `${k}${js.required?.includes(k) ? '*' : ''}: ${typeOf(v)}`,
      ...(v.default !== undefined ? [`default ${JSON.stringify(v.default)}`] : []),
      ...limits(v),
      ...(v.description ? [v.description] : []),
    ];
    return `    - ${parts.join('; ')}`;
  });
}

/** Per tool: name — description (first sentence); rights marks; one line per argument (* = required). */
const block = (d: McpToolMeta) => {
  const marks = [
    d.write ? 'write' : 'read',
    ...(d.danger ? [`needs confirmation in chat: ${d.danger}`] : []),
    ...(d.dangerIf ? ['needs confirmation in chat for some arguments'] : []),
  ];
  const a = args(d);
  return [
    `- ${d.name} — ${firstSentence(d.description)} [${marks.join('; ')}]`,
    ...(a.length ? ['  Arguments:', ...a] : ['  Arguments: none.']),
  ];
};

export function mcpSection(defs: McpToolMeta[]): { id: 'mcp'; title: string; body: string } {
  return {
    id: 'mcp',
    title: 'MCP tools of the instance',
    body: [
      'MCP endpoint: POST /mcp (stateless, JSON responses; GET is 405). Auth is a Bearer API token only; cookies are not accepted. Tools run with the rights of the token owner. A read-only token gets "forbidden" on every [write] tool. [read] tools work with any token. [needs confirmation in chat] is applied only by the in-app AI chat (it asks the user first); over MCP the tool runs at once. Arguments: name* = required, then type, default, limits, description. Tool descriptions are in the language of the registry.',
      '',
      ...defs.flatMap(block),
      '',
      'Besides the registry, the endpoint adds AI pack tools (modules/ai/api/pack-tools.ts).',
      'Agent runs: the runner container does not get an MCP address or token. It gets PLANAR_API_URL (default http://api:3000, NO_PROXY=api), a per-run secret PLANAR_RUN_SECRET, and run-scoped URLs under /api/ai (llm, result, heartbeat, events). Outside traffic goes through the proxy.',
      'MCP or REST: MCP is for an external agent or client that holds an API token and wants named tools. REST /api/v1 is the same operations over plain HTTP for code and integrations. Both reach the same RestService, so rights are the same.',
    ].join('\n'),
  };
}
