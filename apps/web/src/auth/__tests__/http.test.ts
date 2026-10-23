import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/http';
import { json, mockFetch } from './helpers';

describe('auth:http-error', () => {
  it('разбирает {code,message,details}', async () => {
    mockFetch(() => json(400, { code: 'invalid_request', message: 'bad', details: [1] }));
    const e = await api('POST', '/x', {}).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, code: 'invalid_request', message: 'bad', details: [1] });
  });
  it('не-JSON тело -> internal; 204 -> undefined', async () => {
    mockFetch(() => new Response('<html>', { status: 502 }));
    expect(await api('GET', '/x').catch((x) => x)).toMatchObject({ status: 502, code: 'internal' });
    mockFetch(() => json(204));
    expect(await api('POST', '/x')).toBeUndefined();
  });
  it('сетевой сбой -> network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    expect(await api('GET', '/x').catch((x) => x)).toMatchObject({ status: 0, code: 'network' });
  });
});
