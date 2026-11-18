import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// Android Chrome красит нижнюю системную панель PWA статичным theme_color манифеста, мета-тег
// theme-color на неё не влияет: страница рисуется под панелями, контент — в safe-area (PLNRAPP-256)
describe('PWA edge-to-edge', () => {
  it('viewport с viewport-fit=cover', () => {
    expect(read('../../index.html')).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
  });

  it('#app держит контент внутри safe-area', () => {
    const app = /#app \{[^}]*\}/g;
    const rules = read('../styles.css').match(app)?.join('\n') ?? '';
    for (const side of ['top', 'right', 'bottom', 'left'])
      expect(rules).toContain(`env(safe-area-inset-${side})`);
  });

  it('theme_color манифеста — фирменный фиолетовый (нижняя панель Android)', () => {
    expect(read('../../vite.config.ts')).toMatch(/theme_color: '#4f46e5'/);
  });
});
