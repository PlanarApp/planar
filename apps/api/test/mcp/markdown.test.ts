import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc } from '@planar/editor/markdown';
import { normalize } from '../../src/collab/ydoc.js';

describe('markdown ↔ doc (PLNRAPP-180)', () => {
  it('md → doc по схеме редактора: узлы, которые принимает collab', () => {
    const d = markdownToDoc(
      '# H\n\n**b** `c` [l](https://x.y)\n\n- [ ] t\n\n1. o\n\n| A |\n|---|\n| 1 |\n\n```ts\nx\n```\n\n> q\n\n---',
    );
    expect(d.content.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'taskList',
      'orderedList',
      'table',
      'codeBlock',
      'blockquote',
      'horizontalRule',
    ]);
    expect(() => normalize(d)).not.toThrow();
    expect(markdownToDoc('')).toEqual({ type: 'doc', content: [] });
  });

  it('doc → md: упоминание — @login, круг md → doc → md сохраняет текст', () => {
    const md = docToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'к ' },
            { type: 'mention', attrs: { id: 'u1', label: 'ivan' } },
          ],
        },
      ],
    });
    expect(md.trim()).toBe('к @ivan');
    const src = '## Итог\n\n- [x] готово\n- [ ] осталось';
    expect(docToMarkdown(markdownToDoc(src))).toContain('- [x] готово');
  });
  it('одиночный перенос строки — hardBreak (PLNRAPP-334); в коде \\n остаётся', () => {
    const d = markdownToDoc('Итог:\nстрока\n\n```\nx\ny\n```');
    expect(d.content[0]!.content).toEqual([
      { type: 'text', text: 'Итог:' },
      { type: 'hardBreak' },
      { type: 'text', text: 'строка' },
    ]);
    expect(d.content[1]!.content!.map((n) => [n.type, n.text])).toEqual([['text', 'x\ny']]);
    expect(() => normalize(d)).not.toThrow();
    expect(markdownToDoc(docToMarkdown(d))).toEqual(d);
    // md → doc → md keeps the text: hardBreak back as a plain \n, not `  \n` (packs round-trip)
    expect(docToMarkdown(d).split('\n').slice(0, 2)).toEqual(['Итог:', 'строка']);
  });
});
