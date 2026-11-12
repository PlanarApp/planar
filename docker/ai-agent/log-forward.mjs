// Лог агента (PLNRAPP-199, контракт ai10 §2): stdout агента построчно → POST $PLANAR_EVENTS_URL пачками
// {lines: [...]}, раз в 2 с или по 50 строк. Разбор, маскирование секретов и хвост — на стороне api.
// Никогда не падает и дочитывает stdin до конца: ошибка отправки не должна ронять прогон (агент не получит SIGPIPE).
import { createInterface } from 'node:readline';

const url = process.env.PLANAR_EVENTS_URL;
const auth = `Bearer ${process.env.PLANAR_RUN_SECRET ?? ''}`;
const MAX_STR = 4000; // строка внутри JSON-события; api всё равно сокращает до 2000
const MAX_LINE = 64 * 1024; // строка после сокращения: длиннее — обрезается (api покажет её как текст)
const MAX_LINES = 50;
const MAX_BYTES = 128 * 1024; // символов в пачке: тело с экранированием и UTF-8 меньше лимита api (1 МБ)

let batch = [];
let bytes = 0;
let chain = Promise.resolve();

const cut = (v) =>
  typeof v === 'string'
    ? v.length > MAX_STR
      ? `${v.slice(0, MAX_STR)}…`
      : v
    : Array.isArray(v)
      ? v.map(cut)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)]))
        : v;

function shrink(line) {
  if (line.length <= MAX_STR) return line;
  let s = line;
  try {
    s = JSON.stringify(cut(JSON.parse(line)));
  } catch {
    // не JSON — просто текст
  }
  return s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}…` : s;
}

function flush() {
  if (!batch.length || !url) return void ((batch = []), (bytes = 0));
  const body = JSON.stringify({ lines: batch });
  batch = [];
  bytes = 0;
  chain = chain
    .then(() =>
      fetch(url, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      }),
    )
    .then((r) => r.body?.cancel())
    .catch(() => {});
}

setInterval(flush, 2000).unref();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  try {
    const s = shrink(line);
    if (bytes + s.length > MAX_BYTES) flush();
    batch.push(s);
    bytes += s.length;
    if (batch.length >= MAX_LINES) flush();
  } catch {
    // строка потеряна, поток — нет
  }
});
rl.on('close', () => {
  flush();
  // последние события уходят до результата: entrypoint ждёт выхода из конвейера
  chain.finally(() => process.exit(0));
});
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
