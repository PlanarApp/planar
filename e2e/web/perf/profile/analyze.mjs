// node analyze.mjs <file.cpuprofile> [dist/assets dir] — self-time по исходным файлам/пакетам (через sourcemap)
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(
  `${here}../../../../node_modules/.pnpm/source-map-js@1.2.2/node_modules/`,
);
const { SourceMapConsumer } = require('source-map-js');
const [file, assets = `${here}../../../../apps/web/dist/assets`] = process.argv.slice(2);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const cons = new Map();
const consumer = (url) => {
  const name = url.split('/').pop();
  if (!cons.has(name)) {
    const p = `${assets}/${name}.map`;
    cons.set(
      name,
      existsSync(p) ? new SourceMapConsumer(JSON.parse(readFileSync(p, 'utf8'))) : null,
    );
  }
  return cons.get(name);
};
const self = new Map(); // id -> µs
for (let i = 0; i < prof.samples.length; i++)
  self.set(
    prof.samples[i],
    (self.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i + 1] ?? prof.timeDeltas[i]),
  );
const cat = (src) => {
  if (!src) return '?';
  const m = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(src);
  if (m) return m[1];
  const s = src.replace(/^(\.\.\/)+/, '');
  return s.startsWith('src/')
    ? 'app:' + s.split('/').slice(0, 2).join('/')
    : s.startsWith('packages')
      ? s.split('/').slice(0, 2).join('/')
      : s;
};
const byCat = {},
  byFn = {};
let total = 0,
  idle = 0;
for (const n of prof.nodes) {
  const us = self.get(n.id) ?? 0;
  if (!us) continue;
  const cf = n.callFrame;
  total += us;
  if (['(idle)'].includes(cf.functionName)) {
    idle += us;
    continue;
  }
  let c = cf.functionName.startsWith('(') ? cf.functionName : 'native/?',
    src = '',
    fn = cf.functionName || '(anon)';
  if (cf.url && cf.lineNumber >= 0) {
    const sm = consumer(cf.url);
    const o = sm?.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
    src = o?.source ?? cf.url.split('/').pop();
    c = cat(src);
    fn =
      (o?.name ?? fn) +
      ' @' +
      cat(src) +
      (o?.source ? ':' + o.source.split('/').pop() + ':' + o.line : '');
  }
  byCat[c] = (byCat[c] ?? 0) + us;
  byFn[fn] = (byFn[fn] ?? 0) + us;
}
const top = (o, k) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([n, us]) => [n, +(us / 1000).toFixed(1)]);
console.log(
  JSON.stringify(
    {
      total_ms: +(total / 1000).toFixed(0),
      idle_ms: +(idle / 1000).toFixed(0),
      busy_ms: +((total - idle) / 1000).toFixed(0),
      by_category: top(byCat, 14),
      top_functions: top(byFn, 25),
    },
    null,
    1,
  ),
);
