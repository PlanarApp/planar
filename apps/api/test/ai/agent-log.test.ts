// PLNRAPP-199: the agent's log — Claude Code stream-json / opencode json → events, masking, shortening.
import { describe, expect, it } from 'vitest';
import {
  AGENT_LOG_MAX_TEXT,
  cleanEvents,
  maskSecrets,
  parseAgentLines,
  shorten,
} from '../../../../modules/ai/api/agent-log.js';

const line = (o: object) => JSON.stringify(o);

describe('agent-log: разбор', () => {
  it('Claude Code stream-json: рассуждения, команда, инструмент, вывод, итог; служебное пропущено', () => {
    const tools = new Map<string, string>();
    const first = parseAgentLines(
      [
        line({ type: 'system', subtype: 'init', tools: ['Bash'] }),
        line({
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'думаю' },
              { type: 'text', text: 'Смотрю код' },
              { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
              { type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'foo', path: 'src' } },
            ],
          },
        }),
      ],
      tools,
    );
    expect(first).toEqual([
      { type: 'thought', tool: null, text: 'думаю' },
      { type: 'thought', tool: null, text: 'Смотрю код' },
      { type: 'command', tool: 'Bash', text: 'ls' },
      { type: 'tool_call', tool: 'Grep', text: 'foo в src' },
    ]);
    // the tool's output comes in the next batch: the name is remembered by tool_use id
    const next = parseAgentLines(
      [
        line({
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 't1', content: 'a.ts' },
              {
                type: 'tool_result',
                tool_use_id: 't2',
                content: [{ type: 'text', text: 'нет' }],
                is_error: true,
              },
            ],
          },
        }),
        line({
          type: 'result',
          subtype: 'success',
          num_turns: 4,
          duration_ms: 61000,
          result: 'ok',
        }),
      ],
      tools,
    );
    expect(next).toEqual([
      { type: 'output', tool: 'Bash', text: 'a.ts' },
      { type: 'output', tool: 'Grep', text: 'ошибка: нет' },
      { type: 'result', tool: null, text: 'готово, ходов: 4, 61 с\nok' },
    ]);
  });

  it('opencode --format json: текст, рассуждение, bash с выводом, ошибка; шаги пропущены', () => {
    const s = { timestamp: 1, sessionID: 'ses' };
    expect(
      parseAgentLines([
        line({ ...s, type: 'step_start', part: { type: 'step-start' } }),
        line({ ...s, type: 'reasoning', part: { type: 'reasoning', text: 'план' } }),
        line({ ...s, type: 'text', part: { type: 'text', text: 'Делаю' } }),
        line({
          ...s,
          type: 'tool_use',
          part: {
            type: 'tool',
            tool: 'bash',
            state: { status: 'completed', input: { command: 'pnpm lint' }, output: 'чисто' },
          },
        }),
        line({
          ...s,
          type: 'tool_use',
          part: {
            type: 'tool',
            tool: 'read',
            state: { status: 'error', input: { filePath: 'x.ts' }, error: 'нет файла' },
          },
        }),
        line({ ...s, type: 'error', error: { name: 'APIError', data: { message: 'лимит' } } }),
      ]),
    ).toEqual([
      { type: 'thought', tool: null, text: 'план' },
      { type: 'thought', tool: null, text: 'Делаю' },
      { type: 'command', tool: 'bash', text: 'pnpm lint' },
      { type: 'output', tool: 'bash', text: 'чисто' },
      { type: 'tool_call', tool: 'read', text: 'x.ts' },
      { type: 'output', tool: 'read', text: 'ошибка: нет файла' },
      { type: 'result', tool: null, text: 'ошибка: лимит' },
    ]);
  });

  it('не событие агента — текстом; пустые строки пропущены', () => {
    expect(parseAgentLines(['', 'Hello', '{"a":1}', '{oops'])).toEqual([
      { type: 'output', tool: null, text: 'Hello' },
      { type: 'output', tool: null, text: '{"a":1}' },
      { type: 'output', tool: null, text: '{oops' },
    ]);
  });
});

describe('agent-log: маскирование и объём', () => {
  it('известные секреты и похожие на токены строки → ***', () => {
    const cases: [string, string][] = [
      ['key RUN-SECRET-123 here', 'key *** here'],
      ['Authorization: Bearer abc.def-ghi_jkl', 'Authorization: Bearer ***'],
      ['https://oauth2:glpat-x@gitlab.com/a.git', 'https://oauth2:***@gitlab.com/a.git'],
      ['GITLAB_TOKEN=glpat-ABCDEFGHIJKLMNOPQRST', 'GITLAB_TOKEN=***'],
      ['"api_key": "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"', '"api_key": "***"'],
      ['ghp_abcdefghijklmnopqrstuvwxyz0123', '***'],
      ['password=hunter2hunter2', 'password=***'],
    ];
    for (const [src, want] of cases) expect(maskSecrets(src, ['RUN-SECRET-123']), src).toBe(want);
    // numbers after token-like keys are not secrets
    expect(maskSecrets('"input_tokens":1234, max_tokens: 4096')).toBe(
      '"input_tokens":1234, max_tokens: 4096',
    );
  });

  it('длинный текст — начало и конец; маскирование до сокращения', () => {
    const long = `начало ${'x'.repeat(5000)} конец`;
    const s = shorten(long);
    expect(s.length).toBeLessThan(AGENT_LOG_MAX_TEXT + 60);
    expect(s.startsWith('начало')).toBe(true);
    expect(s.endsWith('конец')).toBe(true);
    // the secret right at the cut: masked whole, no half left
    const secret = 'S'.repeat(40);
    const text = `${'a'.repeat(1320)}${secret}${'b'.repeat(3000)}`;
    const [ev] = cleanEvents([{ type: 'output', tool: null, text }], [secret]);
    expect(ev!.text).not.toMatch(/SSSSSS/);
    // NUL of binary output: Postgres text refuses it
    expect(cleanEvents([{ type: 'output', tool: null, text: 'a\u0000b' }], [])[0]!.text).toBe('ab');
  });
});
