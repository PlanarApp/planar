import { expect, test } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PLNRAPP-97: клавиши открытой задачи — t метки, p приоритет, w наблюдать, пробел таймер,
// > подзадача, - пункт чек-листа, l связь
test('PLNRAPP-97: t/p/w/пробел/>/-/l в окне задачи', async ({ browser }) => {
  const f = await fixture(['PLNRAPP97 задача']);
  const page = await loginAs(browser, 'admin');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/t/${f.taskKeys[0]}`);
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.getByTestId('task-props')).toBeVisible();

  for (const key of ['t', 'p']) {
    await blur();
    await page.keyboard.press(key);
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
  }

  await blur();
  await page.keyboard.press('w');
  await expect(page.getByTestId('watch')).toHaveText('Не следить');
  await page.keyboard.press('w');
  await expect(page.getByTestId('watch')).toHaveText('Следить');

  await blur();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();
  await blur();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Старт' })).toBeVisible();

  await blur();
  await page.keyboard.press('>');
  await expect(page.getByPlaceholder('Добавить подзадачу')).toBeFocused();
  await expect(page.getByPlaceholder('Добавить подзадачу')).toHaveValue('');
  await blur();
  await page.keyboard.press('-');
  await expect(page.getByPlaceholder('Добавить пункт')).toBeFocused();
  await expect(page.getByPlaceholder('Добавить пункт')).toHaveValue('');
  await blur();
  await page.keyboard.press('l');
  await expect(page.getByPlaceholder('Найти задачу по названию или ключу')).toBeFocused();
});
