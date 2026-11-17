import { describe, expect, it } from 'vitest';
import { AI_EVENTS } from '../shared/harness.js';
import { AI_RUN_EVENT_TYPES, AI_RUN_KINDS, AI_RUN_STATES } from '../shared/index.js';
import { tr, type Key } from './data';

describe('ИИ: словарь', () => {
  // PLNRAPP-433: прогон «в очереди» ронял таб ИИ задачи — у st_queued не было перевода
  it('у каждого состояния, вида прогона, события лога и события ИИ есть перевод', () => {
    const keys = [
      ...AI_RUN_STATES.map((s) => `st_${s}`),
      ...AI_RUN_KINDS.map((k) => `k_${k}`),
      ...AI_RUN_EVENT_TYPES.map((e) => `ev_${e}`),
      ...AI_EVENTS.map((e) => `event_${e}`),
    ];
    const missing = keys.filter((k) => tr(k as Key) === k);
    expect(missing).toEqual([]);
  });

  it('неизвестный ключ — сам ключ, а не исключение', () => {
    expect(tr('st_unknown' as Key)).toBe('st_unknown');
  });
});
