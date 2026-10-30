// CSP frame-src: the policy only narrows — it is inserted once, before the first plugin iframe.
let allowed: Set<string> | null = null;

export function ensureFrameCsp(origins: string[], doc: Document = document): Set<string> {
  if (allowed) return allowed;
  allowed = new Set(origins);
  const meta = doc.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = `frame-src ${origins.length ? [...allowed].join(' ') : "'none'"}`;
  doc.head.appendChild(meta);
  return allowed;
}
/** false — the plugin was added after the policy was inserted: it is shown after a reload. */
export const frameAllowed = (origin: string): boolean => !!allowed?.has(origin);
/** for tests */
export const resetFrameCsp = (): void => void (allowed = null);

/** The CSP is fixed only from the loaded list: undefined — wait (otherwise frame-src 'none' forever). */
export const ensureWhenLoaded = (origins: string[] | undefined, doc?: Document): boolean => {
  if (!origins) return false;
  ensureFrameCsp(origins, doc);
  return true;
};
