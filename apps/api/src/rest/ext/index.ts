import { z } from 'zod';
import { HttpError } from '../../auth/errors.js';
import { area as attachments } from './attachments.js';
import { area as chat } from './chat.js';
import { area as docs } from './docs.js';
import { area as forms } from './forms.js';
import { area as instance } from './instance.js';
import { area as integrations } from './integrations.js';
import { area as mailgit } from './mailgit.js';
import { area as planning } from './planning.js';
import { area as spaces } from './spaces.js';
import { area as tasks } from './tasks.js';
import { area as templates } from './templates.js';
import { area as time } from './time.js';
import { area as views } from './views.js';
import type { ExtArea, ExtDeps, ExtOp } from './types.js';

export type { ExtArea, ExtDeps, ExtOp } from './types.js';

export const EXT_AREAS: ExtArea[] = [
  spaces,
  instance,
  tasks,
  attachments,
  views,
  planning,
  time,
  templates,
  forms,
  docs,
  chat,
  integrations,
  mailgit,
];

/** all operations; a duplicate tool or METHOD+path is a programming error */
export function buildExtOps(areas: ExtArea[]): ExtOp[] {
  const tools = new Set<string>();
  const routes = new Set<string>();
  const ops = areas.flatMap((a) => a.ops);
  for (const o of ops) {
    const route = `${o.method.toUpperCase()} ${o.path}`;
    if (tools.has(o.tool)) throw new Error(`ext: duplicate tool ${o.tool}`);
    if (routes.has(route)) throw new Error(`ext: duplicate route ${route}`);
    tools.add(o.tool);
    routes.add(route);
  }
  return ops;
}

const hooked: ExtArea[] = [];
let cache: ExtOp[] | undefined;
/** Test hook: adds an area (call before createApp). Production areas live in EXT_AREAS. */
export function registerExtArea(a: ExtArea) {
  buildExtOps([...EXT_AREAS, ...hooked, a]);
  hooked.push(a);
  cache = undefined;
}
export const extOps = () => (cache ??= buildExtOps([...EXT_AREAS, ...hooked]));

/**
 * One call: input is already merged from path and body/query; parsed here (400 invalid_request).
 * preparsed — input is already the output of z.object(op.shape) (MCP SDK, AI chat): a second parse
 * would fail on transforms such as z.stringbool(), which takes "true" but not the boolean it produced.
 */
export async function runExt(
  op: ExtOp,
  d: ExtDeps,
  userId: string,
  input: unknown,
  tokenId?: string,
  opts?: { preparsed?: boolean },
) {
  if (opts?.preparsed) return op.run(d, userId, (input ?? {}) as never, tokenId);
  const r = z.object(op.shape).safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, 'invalid_request', 'Неверные параметры', r.error.issues);
  return op.run(d, userId, r.data, tokenId);
}

export const pathParams = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);

/** the op and path params for a request path, or undefined */
export function matchExt(method: string, url: string) {
  const parts = url.split('?')[0]!.split('/');
  for (const o of extOps()) {
    if (o.method !== method.toLowerCase()) continue;
    const t = o.path.split('/');
    if (t.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = t.every((seg, i) => {
      const m = /^\{(\w+)\}$/.exec(seg);
      if (m) {
        try {
          params[m[1]!] = decodeURIComponent(parts[i]!);
        } catch {
          return false;
        }
        return params[m[1]!] !== '';
      }
      return seg === parts[i];
    });
    if (ok) return { op: o, params };
  }
}
