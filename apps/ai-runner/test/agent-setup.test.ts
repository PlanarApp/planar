import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const SCRIPT = 'scripts/agent-setup.sh';

describe('скрипт подготовки окружения агента', () => {
  it('исполняемый и синтаксически корректный bash', () => {
    accessSync(root(SCRIPT), constants.X_OK);
    execFileSync('bash', ['-n', root(SCRIPT)]);
  });

  it('три шага: зависимости, тестовая БД, smoke-тесты; локальные адреса мимо прокси', () => {
    const s = readFileSync(root(SCRIPT), 'utf8');
    expect(s).toContain('pnpm install --frozen-lockfile');
    expect(s).toContain('./dev.sh testdb');
    expect(s).toContain('vitest run --project shared --project ai-runner');
    expect(s).toContain('LOCAL_HOSTS=localhost,127.0.0.1');
    expect(s).toContain('export NO_PROXY=');
  });

  it('инструкция «Разработка» велит запускать его перед работой и сообщать об упавшем шаге', () => {
    const dev = readFileSync(root('modules/ai/harnesses/dev/actions/dev.md'), 'utf8');
    expect(dev).toContain(`./${SCRIPT}`);
    expect(dev).toMatch(/упал.*в comment/s);
  });
});
