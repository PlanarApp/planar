// Contract test launch: SETUP_TOKEN / DB_POOL_MAX / DEMO_MODE = docs/contracts/launch.md (C-launch-env, C-launch-setup). Edited only by the launch coordinator.
// Code that does not exist yet — skipped; LAUNCH_CONTRACT_STRICT=1 — error.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as config from '../src/config.js';

const root = new URL('../../../', import.meta.url);
const strict = process.env.LAUNCH_CONTRACT_STRICT === '1';
const c = config as Record<string, unknown>;
const parseDbPoolMax = c.parseDbPoolMax as ((raw: string | undefined) => number) | undefined;
const parseDemoMode = c.parseDemoMode as ((raw: string | undefined) => boolean) | undefined;
const present = (f: unknown) => strict || typeof f === 'function';

describe('launch-contract', () => {
  it.skipIf(!present(parseDbPoolMax))(
    'launch-contract DB_POOL_MAX: пусто → 10, целое ≥ 1, иначе ошибка',
    () => {
      expect(parseDbPoolMax!(undefined)).toBe(10);
      expect(parseDbPoolMax!('')).toBe(10);
      expect(parseDbPoolMax!('4')).toBe(4);
      for (const bad of ['0', '-1', '2.5', 'abc'])
        expect(() => parseDbPoolMax!(bad), bad).toThrow(/^DB_POOL_MAX: /);
    },
  );

  it.skipIf(!present(parseDemoMode))(
    'launch-contract DEMO_MODE: true/false без учёта регистра, иное — ошибка',
    () => {
      expect(parseDemoMode!(undefined)).toBe(false);
      expect(parseDemoMode!('')).toBe(false);
      expect(parseDemoMode!('TRUE')).toBe(true);
      expect(parseDemoMode!('false')).toBe(false);
      expect(() => parseDemoMode!('yes')).toThrow(/^DEMO_MODE: /);
    },
  );

  it.skipIf(!strict && !existsSync(new URL('.env.example', root)))(
    'launch-contract env: SETUP_TOKEN, DB_POOL_MAX, DEMO_MODE, DEMO_RESET_HOURS — в .env.example',
    () => {
      const env = readFileSync(new URL('.env.example', root), 'utf8');
      const missing = ['SETUP_TOKEN', 'DB_POOL_MAX', 'DEMO_MODE', 'DEMO_RESET_HOURS'].filter(
        (n) => !new RegExp(`^#?\\s*${n}=`, 'm').test(env),
      );
      if (!strict && missing.length === 4) return; // task 4 has not started
      expect(missing).toEqual([]);
    },
  );
});
