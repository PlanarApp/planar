import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** gzip-сумма JS и CSS, которые грузит страница. */
function measure(page) {
  const html = readFileSync(join(dist, page), 'utf8');
  const refs = new Set([
    ...[...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
    ...(page === 'form.html'
      ? [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1])
      : []),
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
  return { kb: (total / 1024).toFixed(1), total, count };
}

const app = measure('index.html');
console.log(`size: initial gzip ${app.kb} KB (limit 200)`);
const form = measure('form.html');
console.log(`size: form gzip ${form.kb} KB (limit 30)`);
if (!app.count || app.total / 1024 > 200 || !form.count || form.total / 1024 > 30) process.exit(1);
