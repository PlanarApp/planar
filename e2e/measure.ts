// Серверные замеры бюджетов §7 на стеке с сидом --tasks 10000; печатает key=value.
import { Client } from './lib.js';

const now = () => performance.now();
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const median = (a: number[]) => sorted(a)[Math.floor(a.length / 2)]!;
const p95 = (a: number[]) => sorted(a)[Math.ceil(a.length * 0.95) - 1]!;
const out = (k: string, v: number | boolean) =>
  console.log(`${k}=${typeof v === 'number' ? Math.round(v) : v}`);

const a = await Client.login('admin');
const b = await Client.login('admin');

const times: number[] = [];
let bytes = 0;
let tasks = 0;
for (let i = 0; i < 5; i++) {
  const t0 = now();
  const r = await a.ctx.get(`/sync/bootstrap?clientId=${a.clientId}`);
  const body = await r.body();
  times.push(now() - t0);
  bytes = body.length;
  tasks = JSON.parse(body.toString()).data.tasks.length;
}
const bootstrapMs = median(times);
out('bootstrap_ms', bootstrapMs);
out('bootstrap_bytes', bytes);
out('bootstrap_tasks', tasks);

const { cursor, data } = await a.bootstrap();
const taskId = data.tasks![0]!.id as string;

let t0 = now();
await a.pull(cursor);
out('pull_ms', now() - t0);

const push: number[] = [];
for (let i = 0; i < 20; i++) {
  t0 = now();
  await a.pushOk([a.mut('task.update', { id: taskId, title: `measure push ${i}` })]);
  push.push(now() - t0);
}
out('push_ms_p95', p95(push));

const ws = await b.ws((await b.bootstrap()).cursor);
await new Promise((r) => setTimeout(r, 200));
const poke: number[] = [];
for (let i = 0; i < 23; i++) {
  const next = ws.next();
  t0 = now();
  await a.pushOk([a.mut('task.update', { id: taskId, title: `measure poke ${i}` })]);
  await next;
  if (i >= 3) poke.push(now() - t0); // 3 прогрева
}
ws.close();
const pokeP95 = p95(poke);
out('poke_ms_p95', pokeP95);

const ok = bootstrapMs <= 1500 && pokeP95 <= 500 && tasks >= 10000;
out('budget_ok', ok);
process.exit(ok ? 0 : 1);
