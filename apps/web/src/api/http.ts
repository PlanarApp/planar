export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'network', e instanceof Error ? e.message : 'network');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (res.ok) return undefined as T;
    throw new ApiError(res.status, 'internal', res.statusText || 'internal');
  }
  if (!res.ok) {
    const e = (data ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, e.code ?? 'internal', e.message ?? '', e.details);
  }
  return data as T;
}
