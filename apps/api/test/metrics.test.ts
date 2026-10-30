import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ORIGIN } from './auth.js';
import { DB } from '../src/tokens.js';
import { JobsService } from '../src/jobs/jobs.js';
import { testDbUrl } from './db.js';

async function get(
  token: string | undefined,
  auth?: string,
  opts: { push?: object; paths?: [string, string][]; setup?: (app: INestApplication) => void } = {},
) {
  if (token === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = token;
  const app = await createApp({ databaseUrl: testDbUrl(), publicUrl: ORIGIN, push: opts.push });
  await app.init();
  opts.setup?.(app);
  const f = app.getHttpAdapter().getInstance();
  await f.ready();
  await f.inject({ method: 'GET', url: '/api/nope/1' });
  for (const [method, url] of opts.paths ?? []) await f.inject({ method: method as 'GET', url });
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

  it('metrics: счётчик растёт, route — шаблон, /api/health* не считается', async () => {
    const id = '3f2b8c1e-0000-4000-8000-000000000001';
    const res = await get('s3cret', 'Bearer s3cret', {
      paths: [
        ['GET', '/api/auth/me'],
        ['GET', '/api/auth/me'],
        ['PATCH', `/api/users/${id}`],
        ['GET', '/api/health'],
        ['GET', '/api/health/ready'],
      ],
    });
    expect(res.body).toMatch(
      /planar_http_requests_total\{method="GET",route="\/api\/auth\/me",status="\d+"\} 2/,
    );
    expect(res.body).toMatch(/route="\/api\/users\/:id"/);
    expect(res.body).not.toContain(id);
    expect(res.body).not.toContain('/api/health');
  });

  it('metrics: сбой запроса очереди → 200 без planar_queue_jobs-строк', async () => {
    const res = await get('s3cret', 'Bearer s3cret', {
      push: { boss: true, worker: false },
      setup: (app) => {
        const jobs = app.get(JobsService);
        vi.spyOn(jobs, 'enabled', 'get').mockReturnValue(true);
        const db = app.get(DB);
        const real = db.execute.bind(db);
        let n = 0;
        // 1st call — DB size, 2nd — queue
        vi.spyOn(db, 'execute').mockImplementation((q: never) =>
          ++n === 2 ? Promise.reject(new Error('no pgboss')) : real(q),
        );
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/^planar_queue_jobs\{/m);
    expect(res.body).toMatch(/planar_db_size_bytes \d+/);
  });

  it('metrics: сбой размера БД → 200 без planar_db_size_bytes-строки', async () => {
    const res = await get('s3cret', 'Bearer s3cret', {
      setup: (app) => {
        vi.spyOn(app.get(DB), 'execute').mockRejectedValue(new Error('boom'));
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/^planar_db_size_bytes /m);
  });
});
