import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const errs = [];
const read = (f) =>
  existsSync(join(dist, f))
    ? readFileSync(join(dist, f), 'utf8')
    : (errs.push(`нет dist/${f}`), '');

let m = {};
try {
  m = JSON.parse(read('manifest.webmanifest'));
} catch {
  errs.push('manifest.webmanifest не разобрать');
}
for (const k of ['name', 'short_name', 'start_url']) if (!m[k]) errs.push(`manifest: нет ${k}`);
if (m.display !== 'standalone') errs.push('manifest: display != standalone');
const icons = m.icons ?? [];
for (const s of ['192x192', '512x512']) {
  if (!icons.some((i) => i.sizes === s && i.type === 'image/png'))
    errs.push(`manifest: нет иконки ${s} png`);
}
if (!icons.some((i) => (i.purpose ?? '').includes('maskable'))) errs.push('manifest: нет maskable');
for (const i of icons)
  if (!existsSync(join(dist, i.src.replace(/^\//, '')))) errs.push(`нет файла иконки ${i.src}`);
if (!/index\.html/.test(read('sw.js'))) errs.push('sw.js: нет precache index.html');
if (!/rel="manifest"/.test(read('index.html'))) errs.push('index.html не ссылается на manifest');

if (errs.length) {
  console.error(errs.join('\n'));
  process.exit(1);
}
console.log('pwa: ok');
