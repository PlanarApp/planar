import { describe, expect, it } from 'vitest';
import { installed, validateInstalled } from '../../src/modules/installed.js';

describe('wk9: скелеты модулей', () => {
  it('пять модулей установлены и проходят validateInstalled', () => {
    const ids = installed.map((m) => m.api.id);
    for (const id of ['time', 'sprints', 'automations', 'webhooks', 'import'])
      expect(ids).toContain(id);
    expect(() => validateInstalled(installed)).not.toThrow();
  });
});
