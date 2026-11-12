// Fetch helper of the module's own HTTP API (/api/ai/*), shared by the settings and the harness panel.
export class AiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`/api/ai/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (res.status === 204) return undefined as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiApiError(res.status, j.message || String(res.status));
  return j as T;
}
