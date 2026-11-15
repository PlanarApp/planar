// PLNRAPP-199: the agent's log — lines of the agent's stdout from the container (Claude Code `--output-format
// stream-json`, opencode `run --format json`, plain text of an external harness) → events of one schema, shortened
// and with secrets masked. Masking is here, on the api side: the container is not trusted with it.
import type { AiRunEventType } from '../shared/index.js';

export interface AgentLogEvent {
  type: AiRunEventType;
  tool: string | null;
  text: string;
}

/** Characters of one event's text; longer — the head and the tail around «…». */
export const AGENT_LOG_MAX_TEXT = 2000;
/** Events kept per run: the tail, the oldest dropped. */
export const AGENT_LOG_MAX_EVENTS = 500;
/** Lines in one request of the container. */
export const AGENT_LOG_MAX_LINES = 200;

const MASK = '***';

/** Head and tail of a long text: the end of a command's output matters as much as its start. */
export function shorten(s: string, max = AGENT_LOG_MAX_TEXT) {
  const t = s.trim();
  if (t.length <= max) return t;
  const head = Math.ceil((max * 2) / 3);
  return `${t.slice(0, head)}\n… (${t.length - max} симв. пропущено) …\n${t.slice(t.length - (max - head))}`;
}

// well-known token shapes; values after secret-looking keys; credentials in URLs; Authorization headers
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
  [
    /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|glpat-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g,
    MASK,
  ],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${MASK}`],
  [/\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/g, `Basic ${MASK}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${MASK}@`],
  [
    /\b([A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)(?!\*\*\*)(?=[^\s"',;]*[A-Za-z$])[^\s"',;]{8,}/gi,
    `$1${MASK}`,
  ],
];

/** Known secrets of the run (its secret, the provider key, the gitlab token) and token-like strings → `***`. */
export function maskSecrets(text: string, known: readonly (string | null | undefined)[] = []) {
  let s = text;
  for (const k of known) if (k && k.length >= 6) s = s.split(k).join(MASK);
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  return s;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : null;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A command for the log: Bash / opencode bash → its command line. */
const SHELL = new Set(['bash', 'shell', 'exec']);

/** Short arguments of a tool call: the file, the pattern, the url — the rest as JSON. */
function args(input: unknown) {
  const i = obj(input);
  if (!i) return typeof input === 'string' ? input : '';
  for (const k of [
    'file_path',
    'filePath',
    'pattern',
    'url',
    'query',
    'path',
    'description',
    'prompt',
  ])
    if (typeof i[k] === 'string' && i[k]) {
      const rest = k === 'pattern' && typeof i.path === 'string' ? ` в ${i.path}` : '';
      return `${i[k] as string}${rest}`;
    }
  return JSON.stringify(i);
}

function toolUse(name: string, input: unknown): AgentLogEvent {
  const cmd = str(obj(input)?.command);
  return SHELL.has(name.toLowerCase()) && cmd
    ? { type: 'command', tool: name, text: cmd }
    : { type: 'tool_call', tool: name, text: args(input) };
}

/** tool_result content: a string or blocks [{type:'text', text}] (images and the like → a mark). */
function resultText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c))
    return c
      .map((b) => {
        const o = obj(b);
        return o?.type === 'text' ? str(o.text) : o?.type ? `[${str(o.type)}]` : '';
      })
      .filter(Boolean)
      .join('\n');
  return c == null ? '' : JSON.stringify(c);
}

/** Claude Code stream-json: assistant (text, thinking, tool_use), user (tool_result), result. */
function claude(o: J, tools: Map<string, string>): AgentLogEvent[] | null {
  const content = obj(o.message)?.content;
  if (o.type === 'assistant' && Array.isArray(content)) {
    const out: AgentLogEvent[] = [];
    for (const b of content.map(obj)) {
      if (b?.type === 'text' && str(b.text).trim())
        out.push({ type: 'thought', tool: null, text: str(b.text) });
      else if (b?.type === 'thinking' && str(b.thinking).trim())
        out.push({ type: 'thought', tool: null, text: str(b.thinking) });
      else if (b?.type === 'tool_use') {
        const name = str(b.name) || 'tool';
        if (typeof b.id === 'string') tools.set(b.id, name);
        out.push(toolUse(name, b.input));
      }
    }
    return out;
  }
  if (o.type === 'user' && Array.isArray(content)) {
    const out: AgentLogEvent[] = [];
    for (const b of content.map(obj))
      if (b?.type === 'tool_result') {
        const text = resultText(b.content);
        out.push({
          type: 'output',
          tool: tools.get(str(b.tool_use_id)) ?? null,
          text: b.is_error ? `ошибка: ${text}` : text || '(пусто)',
        });
      }
    return out;
  }
  if (o.type === 'result') {
    const parts = [
      o.is_error ? `ошибка (${str(o.subtype) || 'error'})` : 'готово',
      typeof o.num_turns === 'number' ? `ходов: ${o.num_turns}` : '',
      typeof o.duration_ms === 'number' ? `${Math.round(o.duration_ms / 1000)} с` : '',
    ].filter(Boolean);
    const r = str(o.result).trim();
    return [{ type: 'result', tool: null, text: `${parts.join(', ')}${r ? `\n${r}` : ''}` }];
  }
  if (o.type === 'system' || o.type === 'stream_event' || o.type === 'user') return [];
  return null;
}

/** opencode `run --format json`: {type, part} — text, reasoning, tool_use (completed / error), error. */
function opencode(o: J): AgentLogEvent[] | null {
  const part = obj(o.part);
  if (!('sessionID' in o) && !part) return null;
  if ((o.type === 'text' || o.type === 'reasoning') && part)
    return str(part.text).trim() ? [{ type: 'thought', tool: null, text: str(part.text) }] : [];
  if (o.type === 'tool_use' && part) {
    const name = str(part.tool) || 'tool';
    const st = obj(part.state) ?? ({} as J);
    const out = [toolUse(name, st.input)];
    const res = st.status === 'error' ? `ошибка: ${str(st.error)}` : str(st.output);
    out.push({ type: 'output', tool: name, text: res || '(пусто)' });
    return out;
  }
  if (o.type === 'error') {
    const e = obj(o.error);
    const msg = str(obj(e?.data)?.message) || str(e?.name) || JSON.stringify(o.error);
    return [{ type: 'result', tool: null, text: `ошибка: ${msg}` }];
  }
  return [];
}

/**
 * Lines of the agent's stdout → events. A line that is not an event of a known agent goes as `output` (an external
 * harness prints plain text). `tools` — tool_use id → name across the batches of one run (output names its tool).
 */
export function parseAgentLines(
  lines: readonly string[],
  tools: Map<string, string> = new Map(),
): AgentLogEvent[] {
  const out: AgentLogEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let o: J | null = null;
    try {
      o = obj(JSON.parse(line));
    } catch {
      // not JSON — plain text
    }
    const ev = o && (claude(o, tools) ?? opencode(o));
    if (ev) out.push(...ev);
    else out.push({ type: 'output', tool: null, text: line });
  }
  return out;
}

/** Events ready to store: secrets masked, then shortened (masking first — a cut must not reveal half a token). */
export function cleanEvents(
  events: readonly AgentLogEvent[],
  known: readonly (string | null | undefined)[],
) {
  return events
    .map((e) => ({
      type: e.type,
      tool: e.tool && e.tool.slice(0, 100),
      // Postgres text has no NUL: binary output would fail the insert
      text: shorten(maskSecrets(e.text.split('\u0000').join(''), known)),
    }))
    .filter((e) => e.text);
}
