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
});
