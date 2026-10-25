import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ORIGIN } from './auth.js';
import { testDbUrl } from './db.js';

async function get(token: string | undefined, auth?: string) {
  if (token === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = token;
  const app = await createApp({ databaseUrl: testDbUrl(), publicUrl: ORIGIN });
  await app.init();
  const f = app.getHttpAdapter().getInstance();
  await f.ready();
  await f.inject({ method: 'GET', url: '/api/nope/1' });
  const res = await f.inject({
    method: 'GET',
    url: '/api/metrics',
    headers: auth ? { authorization: auth } : {},
  });
  await app.close();
  return res;
}

afterEach(() => {
  delete process.env.METRICS_TOKEN;
});

describe('metrics', () => {
  it('без METRICS_TOKEN → 404 not_found', async () => {
    const res = await get(undefined, 'Bearer x');
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  it('нет или неверный токен → 401 unauthenticated', async () => {
    for (const auth of [undefined, 'Bearer wrong', 'Bearer s3cret-longer', 's3cret']) {
      const res = await get('s3cret', auth);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthenticated');
    }
  });

  it('верный токен → 200, формат Prometheus и все метрики', async () => {
    const res = await get('s3cret', 'Bearer s3cret');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain; version=0.0.4');
    for (const n of [
      'planar_http_requests_total',
      'planar_http_request_duration_seconds_bucket',
      'planar_http_request_duration_seconds_sum',
      'planar_http_request_duration_seconds_count',
      'planar_ws_connections',
      'planar_queue_jobs',
      'planar_db_size_bytes',
    ])
      expect(res.body).toContain(n);
    expect(res.body).toContain('# TYPE planar_http_request_duration_seconds histogram');
    expect(res.body).toMatch(
      /planar_http_requests_total\{method="GET",route="unmatched",status="404"\} \d+/,
    );
    expect(res.body).toMatch(/planar_ws_connections\{path="\/ws"\} 0/);
    expect(res.body).toMatch(/planar_db_size_bytes \d{4,}/);
    expect(res.body).not.toContain('route="/api/metrics"');
  });
});
