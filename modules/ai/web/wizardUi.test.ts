import { describe, expect, it } from 'vitest';
import { canAdvance, nextStep, prevStep, type WizardState } from './wizardUi';

const st = (o: Partial<WizardState> = {}): WizardState => ({
  connected: false,
  packKey: '',
  prompt: '',
  uploaded: false,
  ...o,
});

describe('wizardUi', () => {
  it('шаги идут по порядку и упираются в края', () => {
    expect(nextStep('key')).toBe('template');
    expect(nextStep('harness')).toBe('harness');
    expect(prevStep('pack')).toBe('template');
    expect(prevStep('key')).toBe('key');
  });

  it('canAdvance: ключ → шаблон и промпт → загруженный пакет без конфликтов', () => {
    expect(canAdvance('key', st())).toBe(false);
    expect(canAdvance('key', st({ connected: true }))).toBe(true);
    expect(canAdvance('template', st({ packKey: 'dev', prompt: '  ' }))).toBe(false);
    expect(canAdvance('template', st({ packKey: 'dev', prompt: 'x' }))).toBe(true);
    expect(canAdvance('pack', st())).toBe(false);
    expect(canAdvance('pack', st({ uploaded: true }))).toBe(true);
    expect(canAdvance('harness', st({ uploaded: true }))).toBe(false);
  });
});
