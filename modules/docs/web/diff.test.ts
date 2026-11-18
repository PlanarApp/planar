import { describe, expect, it } from 'vitest';
import { blocks, changes, diffDocs, diffWords } from './diff';

const p = (text: string, type = 'paragraph') => ({ type, content: [{ type: 'text', text }] });
const doc = (...content: object[]) => ({ type: 'doc', content });

describe('docs web: дифф версий (PLNRAPP-282)', () => {
  it('блоки — листовые текстовые узлы, списки раскрываются, картинка — блок', () => {
    const d = doc(
      p('Заголовок', 'heading'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('пункт')] }] },
      { type: 'image', attrs: { src: '/f/1' } },
      { type: 'paragraph' },
    );
    expect(blocks(d)).toEqual([
      { kind: 'heading', text: 'Заголовок' },
      { kind: 'paragraph', text: 'пункт' },
      { kind: 'image', text: '/f/1' },
      { kind: 'paragraph', text: '' },
    ]);
    expect(blocks(null)).toEqual([]);
  });

  it('по словам: заменённое слово — удалено и добавлено, остальное общее; части собираются в обе строки', () => {
    expect(diffWords('старый текст', 'новый текст')).toEqual([
      { op: 'del', text: 'старый' },
      { op: 'ins', text: 'новый' },
      { op: 'eq', text: ' текст' },
    ]);
    const [a, b] = ['план и учёт задач', 'план, учёт и релиз задач'];
    const d = diffWords(a, b);
    expect(d.filter((x) => x.op !== 'ins').map((x) => x.text).join('')).toBe(a);
    expect(d.filter((x) => x.op !== 'del').map((x) => x.text).join('')).toBe(b);
    expect(d.filter((x) => x.op === 'eq').map((x) => x.text.trim())).toContain('задач');
  });

  it('по блокам: общий, изменённый (по словам), добавленный, удалённый', () => {
    const a = doc(p('Видение', 'heading'), p('Мы помогаем командам'), p('Устарело'));
    const b = doc(p('Видение', 'heading'), p('Мы помогаем малым командам'), p('Новый абзац', 'heading'));
    const d = diffDocs(a, b);
    expect(d.map((x) => [x.op, x.kind])).toEqual([
      ['eq', 'heading'],
      ['mod', 'paragraph'],
      ['del', 'paragraph'],
      ['ins', 'heading'],
    ]);
    expect(d[1]!.parts).toEqual([
      { op: 'eq', text: 'Мы помогаем ' },
      { op: 'ins', text: 'малым ' },
      { op: 'eq', text: 'командам' },
    ]);
    expect(changes(d)).toBe(3);
    expect(changes(diffDocs(a, a))).toBe(0);
    expect(diffDocs(null, a).every((x) => x.op === 'ins')).toBe(true);
  });
});
