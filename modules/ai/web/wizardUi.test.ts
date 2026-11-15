import { describe, expect, it } from 'vitest';
import { lineDiff } from '../shared/index.js';
import {
  aiBotOf,
  assignmentBody,
  canAdvance,
  nextStep,
  prevStep,
  type WizardState,
} from './wizardUi';

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

// lineDiff (the retro uses it) lost its test together with wizard/adapt
it('lineDiff: same/add/del построчно', () => {
  expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
    { type: 'same', text: 'a' },
    { type: 'add', text: 'x' },
    { type: 'del', text: 'b' },
    { type: 'same', text: 'c' },
  ]);
});

describe('wizardUi adapt', () => {
  it('assignmentBody: абзац на строку, пустая строка — пустой абзац', () => {
    expect(assignmentBody(' a\n\nb ')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    });
  });

  it('aiBotOf: automation-бот первым — выбирается ai', () => {
    const users = [
      undefined,
      { id: '1', login: 'automation', bot: true },
      { id: '2', login: 'ai', bot: true },
    ];
    expect(aiBotOf(users)?.id).toBe('2');
    expect(aiBotOf([{ id: '3', login: 'ai' }])).toBeUndefined();
  });
});
