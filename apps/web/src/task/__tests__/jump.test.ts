import { describe, expect, it } from 'vitest';
import { commentJump } from '../jump';

const cs = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: 'c' },
];

describe('PLNRAPP-214: переход к комментарию', () => {
  it('корень и прямой ответ — в ленте, ветка раскрывается', () => {
    expect(commentJump(cs, 'a')).toEqual({ thread: null, unfold: ['a'] });
    expect(commentJump(cs, 'b')).toEqual({ thread: null, unfold: ['b', 'a'] });
  });
  it('ответ на ответ и глубже — в треде своего родителя', () => {
    expect(commentJump(cs, 'c')).toEqual({ thread: 'b', unfold: ['c', 'b', 'a'] });
    expect(commentJump(cs, 'd')?.thread).toBe('c');
  });
  it('комментария ещё нет в реплике — null', () => {
    expect(commentJump(cs, 'zzz')).toBeNull();
  });
  it('осиротевший ответ (родитель не догружен) — не зацикливается', () => {
    expect(commentJump([{ id: 'x', parentId: 'missing' }], 'x')).toEqual({
      thread: null,
      unfold: ['x'],
    });
  });
});
