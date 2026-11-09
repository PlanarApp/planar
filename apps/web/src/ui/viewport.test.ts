import { describe, expect, it, vi } from 'vitest';
import { fitVisualViewport } from './viewport';

describe('fitVisualViewport (PLNRAPP-122)', () => {
  it('высота приложения — видимая область, сдвиг страницы от клавиатуры сбрасывается', () => {
    const vv = new EventTarget() as EventTarget & { height: number };
    vv.height = 800;
    const scrollTo = vi.fn();
    const win = { visualViewport: vv, document, scrollY: 0, scrollTo } as unknown as Window;
    fitVisualViewport(win);
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('800px');

    vv.height = 450; // the keyboard opened, the browser panned the page
    (win as { scrollY: number }).scrollY = 300;
    vv.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('450px');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
