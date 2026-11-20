import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

describe('образ агента docker/ai-agent', () => {
  it('pnpm в образе — версия из packageManager корневого package.json', () => {
    const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')) as {
      packageManager: string;
    };
    const dockerfile = readFileSync(root('docker/ai-agent/Dockerfile'), 'utf8');
    const want = /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager)?.[1];
    expect(want).toBeTruthy();
    expect(/^ARG PNPM_VERSION=(\S+)$/m.exec(dockerfile)?.[1]).toBe(want);
    expect(dockerfile).toContain('"pnpm@${PNPM_VERSION}"');
  });

  it('HOME и TMPDIR в /work задаются после установки пакетов: при сборке /work/.tmp нет', () => {
    const dockerfile = readFileSync(root('docker/ai-agent/Dockerfile'), 'utf8');
    const lastInstall = dockerfile.lastIndexOf('apt-get install');
    for (const env of ['HOME=/work/.home', 'TMPDIR=/work/.tmp', 'npm_config_cache=']) {
      const at = dockerfile.indexOf(env);
      expect(at, env).toBeGreaterThan(lastInstall);
    }
  });

  it('сборку образа агента в CI не отменяет следующий конвейер main', () => {
    const ci = readFileSync(root('.gitlab-ci.yml'), 'utf8');
    const job = /^image-ai-agent:\n((?: {2}.*\n)+)/m.exec(ci)?.[1];
    expect(job).toContain('interruptible: false');
  });
});
