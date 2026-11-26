import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  webhooksDeliveries as D,
  webhooksSubscriptions as S,
} from '@planar/module-webhooks/api/schema';
import { parseSource, ParseError } from '@planar/module-import/api';
import {
  MAX_BYTES,
  MAX_ROWS,
  type FileFormat,
  type ImportPreset,
  type Mapping,
} from '@planar/module-import/shared';
import { uuidv7 } from '@planar/shared';
import { HttpError } from '../../auth/errors.js';
import type { ExtDeps } from './types.js';

export { D, S };

export interface ImportInput {
  format: FileFormat;
  preset: ImportPreset;
  content: string;
  mapping?: Mapping;
}

/** parse as the import controller does: ≤ MAX_BYTES, ≤ MAX_ROWS, a parse error is 400 */
export function parseImport(
  content: string,
  format: FileFormat,
  mapping: Mapping | null,
  preset: ImportPreset,
): ReturnType<typeof parseSource> {
  const bad = (m: string) => new HttpError(400, 'invalid_request', m);
  if ((format === 'trello') !== (preset === 'trello')) throw bad('preset не подходит формату');
  if (Buffer.byteLength(content) > MAX_BYTES) throw bad('Файл слишком большой');
  try {
    const p = parseSource(content, format, mapping, preset);
    if (p.items.length > MAX_ROWS) throw new ParseError(`Больше ${MAX_ROWS} строк`);
    return p;
  } catch (e) {
    if (e instanceof ParseError) throw bad(e.message);
    throw e;
  }
}

export const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** whsec_ + 32 random bytes in base62, as in the webhooks controller; never returned to the caller */
export function newSecret(): string {
  let n = BigInt('0x' + randomBytes(32).toString('hex'));
  let s = '';
  for (; n > 0n; n /= 62n) s = B62[Number(n % 62n)]! + s;
  return 'whsec_' + s.padStart(43, '0');
}

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

/** a subscription WITHOUT the secret */
export const subOut = (r: typeof S.$inferSelect) => ({
  id: r.id,
  url: r.url,
  events: r.events,
  active: r.active,
  description: r.description,
  createdBy: r.createdBy,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export const deliveryOut = (r: typeof D.$inferSelect) => ({
  id: r.id,
  subscriptionId: r.subscriptionId,
  event: r.event,
  payload: r.payload,
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: iso(r.nextAttemptAt),
  lastStatus: r.lastStatus,
  lastError: r.lastError,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export async function subRow(d: ExtDeps, id: string) {
  const [r] = isUuid(id) ? await d.db.select().from(S).where(eq(S.id, id)) : [];
  if (!r) throw notFound('Подписка');
  return r;
}

/** a pending delivery; enqueue is not in ExtDeps — the webhooks sweep picks it up */
export async function newDelivery(d: ExtDeps, subscriptionId: string, event: string, data: object) {
  const [row] = await d.db
    .insert(D)
    .values({
      id: uuidv7(),
      subscriptionId,
      event,
      payload: data as Record<string, unknown>,
      status: 'pending',
      nextAttemptAt: new Date().toISOString(),
    })
    .returning();
  return row!;
}
