// CSP frame-src: политика только сужается — вставляется один раз до первого iframe плагина.
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
/** false — плагин добавлен после вставки политики: показывается после перезагрузки. */
export const frameAllowed = (origin: string): boolean => !!allowed?.has(origin);
/** для тестов */
export const resetFrameCsp = (): void => void (allowed = null);
