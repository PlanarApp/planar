// Metrics in process memory, Prometheus exposition by hand (C-ops-health v1).
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labels = (o: Record<string, string>) =>
  `{${Object.entries(o)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(',')}}`;

interface Hist {
  l: Record<string, string>;
  buckets: number[];
  sum: number;
  count: number;
}
const requests = new Map<string, { l: Record<string, string>; n: number }>();
const durations = new Map<string, Hist>();
const ws = new Map<string, number>([
  ['/ws', 0],
  ['/collab', 0],
]);

export function observeRequest(method: string, route: string, status: number, seconds: number) {
  const k = `${method} ${route}`;
  const rk = `${k} ${status}`;
  const r = requests.get(rk) ?? { l: { method, route, status: String(status) }, n: 0 };
  r.n++;
  requests.set(rk, r);
  const h = durations.get(k) ?? {
    l: { method, route },
    buckets: BUCKETS.map(() => 0),
    sum: 0,
    count: 0,
  };
  BUCKETS.forEach((b, i) => {
    if (seconds <= b) h.buckets[i]!++;
  });
  h.sum += seconds;
  h.count++;
  durations.set(k, h);
}

/** Open WS connection `/ws` or `/collab`; returns the close function. */
export function wsOpened(path: '/ws' | '/collab'): () => void {
  ws.set(path, ws.get(path)! + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    ws.set(path, ws.get(path)! - 1);
  };
}

export interface Snapshot {
  /** null — queue is disabled */
  queue: { queue: string; state: string; n: number }[] | null;
  /** null — the request failed */
  dbSize: number | null;
}

export function render(s: Snapshot): string {
  const o: string[] = [];
  o.push(
    '# HELP planar_http_requests_total HTTP requests',
    '# TYPE planar_http_requests_total counter',
  );
  for (const r of requests.values()) o.push(`planar_http_requests_total${labels(r.l)} ${r.n}`);
  o.push(
    '# HELP planar_http_request_duration_seconds HTTP request duration',
    '# TYPE planar_http_request_duration_seconds histogram',
  );
  for (const h of durations.values()) {
    const n = 'planar_http_request_duration_seconds';
    BUCKETS.forEach((b, i) =>
      o.push(`${n}_bucket${labels({ ...h.l, le: String(b) })} ${h.buckets[i]}`),
    );
    o.push(`${n}_bucket${labels({ ...h.l, le: '+Inf' })} ${h.count}`);
    o.push(`${n}_sum${labels(h.l)} ${h.sum}`, `${n}_count${labels(h.l)} ${h.count}`);
  }
  o.push(
    '# HELP planar_ws_connections Open WebSocket connections',
    '# TYPE planar_ws_connections gauge',
  );
  for (const [path, n] of ws) o.push(`planar_ws_connections${labels({ path })} ${n}`);
  o.push('# HELP planar_queue_jobs pg-boss jobs', '# TYPE planar_queue_jobs gauge');
  for (const q of s.queue ?? [])
    o.push(`planar_queue_jobs${labels({ queue: q.queue, state: q.state })} ${q.n}`);
  o.push('# HELP planar_db_size_bytes Database size', '# TYPE planar_db_size_bytes gauge');
  if (s.dbSize !== null) o.push(`planar_db_size_bytes ${s.dbSize}`);
  return o.join('\n') + '\n';
}
