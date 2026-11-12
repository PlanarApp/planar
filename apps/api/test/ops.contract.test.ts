// Contract test ops: compose.yml, deploy/Caddyfile, web *.html, metrics, ops/*.sh = docs/contracts/ops.md. Edited only by the ops coordinator.
// Code that does not exist yet (metrics, ops/) — skip; OPS_CONTRACT_STRICT=1 — error.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const strict = process.env.OPS_CONTRACT_STRICT === '1';

const doc = read('docs/contracts/ops.md');
const block = (name: string) => {
  const m = doc.match(new RegExp('```(?:text|json) ' + name + '\\n([\\s\\S]*?)```'));
  if (!m) throw new Error(`нет блока ${name} в ops.md`);
  return m[1];
};
const lines = (name: string) =>
  block(name)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const envSection = doc.slice(doc.indexOf('## C-ops-env'), doc.indexOf('## C-ops-volumes'));
const env = [...envSection.matchAll(/^\| `([A-Z_]+)` \| ([a-z,]+) \|/gm)].map((m) => ({
  name: m[1],
  where: m[2].split(','),
}));

const compose = read('compose.yml');
const caddy = read('deploy/Caddyfile');

function srcFiles(dir: URL): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|sh)$/.test(e.name) && !e.name.endsWith('.test.ts'))
    .map((e) => readFileSync(`${e.parentPath}/${e.name}`, 'utf8'));
}

describe('ops-contract', () => {
  it('ops-contract env: переменные compose.yml и Caddyfile = C-ops-env', () => {
    expect(env.length).toBeGreaterThan(0);
    const used = new Set([
      ...[...compose.matchAll(/\$\{([A-Z_]+)/g)].map((m) => m[1]),
      ...[...caddy.matchAll(/\{\$([A-Z_]+)/g)].map((m) => m[1]),
    ]);
    const declared = new Set(
      env.filter((e) => !e.where.every((w) => w === 'ops')).map((e) => e.name),
    );
    expect(
      [...used].filter((n) => !declared.has(n)).sort(),
      'есть в compose/Caddyfile, нет в контракте',
    ).toEqual([]);
    expect(
      [...declared].filter((n) => !used.has(n)).sort(),
      'есть в контракте, нет в compose/Caddyfile',
    ).toEqual([]);
    for (const n of env.filter((e) => e.where.includes('caddy')).map((e) => e.name))
      expect(caddy, `Caddyfile не читает ${n}`).toContain(`{$${n}`);
  });

  it('ops-contract volumes: тома compose.yml = C-ops-volumes', () => {
    const vols = lines('ops-volumes').map((l) => l.split(/\s+/));
    for (const [, vol, path] of vols)
      expect(compose, `том ${vol}:${path}`).toContain(`${vol}:${path}`);
    const top = compose.slice(compose.search(/^volumes:/m));
    const topNames = [...top.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]).sort();
    expect(topNames).toEqual(vols.map((v) => v[1]).sort());
  });

  it('ops-contract headers: заголовки Caddyfile = C-ops-headers, хэши встроенных скриптов web', () => {
    const scripts = ['apps/web/index.html', 'apps/web/form.html']
      .filter((p) => existsSync(new URL(p, root)))
      .flatMap((p) => [...read(p).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]));
    const hashes = scripts
      .map((s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`)
      .join(' ');
    for (const l of lines('ops-headers')) {
      const i = l.indexOf(': ');
      const name = l.slice(0, i);
      const value = l.slice(i + 2).replace('{inline-hashes}', hashes);
      expect(caddy, `заголовок ${name}`).toMatch(
        new RegExp(`${name}\\s+"${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      );
    }
    expect(caddy).toMatch(/-Server\b/);
  });

  it('ops-contract: эндпоинты агент-контейнера (llm, result, heartbeat) закрыты до @backend', () => {
    const m =
      /@agentOnly \{[^}]*path_regexp (\S+)[^}]*\}\s*handle @agentOnly \{\s*respond 404/.exec(caddy);
    expect(m).not.toBeNull();
    expect(caddy.indexOf('@agentOnly')).toBeLessThan(caddy.indexOf('@backend'));
    const re = new RegExp(m![1]);
    for (const p of ['/api/ai/llm/x/v1/messages', '/api/ai/runs/x', '/api/ai/runs/x/heartbeat'])
      expect(re.test(p), p).toBe(true);
    for (const p of ['/api/ai/runs/x/stop', '/api/ai/runs/x/restart', '/api/ai/runs'])
      expect(re.test(p), p).toBe(false);
  });

  it('ops-contract metrics: имена C-ops-health есть в коде api', () => {
    const src = srcFiles(new URL('apps/api/src/', root)).join('\n');
    if (!src.includes('/api/metrics') && !strict) return;
    for (const l of lines('ops-metrics')) expect(src, `метрика ${l}`).toContain(l.split(/\s+/)[0]);
    expect(src).toContain('health/ready');
  });

  it('ops-contract backup: формат C-ops-backup в ops/*.sh', () => {
    const sh = srcFiles(new URL('ops/', root)).join('\n');
    if (!sh && !strict) return;
    const manifest = JSON.parse(block('ops-backup-manifest')) as {
      format: string;
      version: number;
    };
    expect(sh).toContain(manifest.format);
    expect(sh).toContain('BACKUP_DIR');
    expect(sh).toContain('.partial');
    for (const f of ['backup.sh', 'restore.sh', 'upgrade.sh'])
      if (strict || f !== 'upgrade.sh')
        expect(existsSync(new URL(`ops/${f}`, root)), `ops/${f}`).toBe(true);
  });
});
