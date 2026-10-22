import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = new Set([
  ...[...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
]);
let total = 0;
let count = 0;
for (const ref of refs) {
  const f = join(dist, ref.replace(/^\//, ''));
  if (!existsSync(f)) continue;
  const n = gzipSync(readFileSync(f), { level: 9 }).length;
  console.log(`${ref}: ${(n / 1024).toFixed(1)} KB`);
  total += n;
  count++;
}
const kb = (total / 1024).toFixed(1);
console.log(`size: initial gzip ${kb} KB (limit 200)`);
if (!count || total / 1024 > 200) process.exit(1);
