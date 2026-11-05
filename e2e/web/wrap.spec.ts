import { expect, test, type Page } from '@playwright/test';
import { fixture, loginAs } from './helpers.js';

// PLANARAPP-55/56: "Wrap task names" — the whole name is shown wrapped in the List, Board and Table;
// the row grows and does not overlap the next one
const LONG =
  'Очень длинное название задачи, которое точно не поместится в одну строку и должно переноситься по словам на несколько строк без обрезки';

async function wrapOn(page: Page) {
  await page.getByTestId('view-toggle').click();
  await page.getByTestId('wrap-titles').check();
  await page.keyboard.press('Escape');
}
/** the name's box: whole text visible (not cut), taller than one line */
async function expectWrapped(page: Page, title: ReturnType<Page['getByText']>) {
  await expect(title).toBeVisible();
  await expect
    .poll(() =>
      title.evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight + 1),
    )
    .toBe(true);
  await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(30);
}

for (const view of ['list', 'board', 'table'] as const)
  test(`PLANARAPP-55/56: «Переносить названия» — ${view}`, async ({ browser }, info) => {
    const f = await fixture([LONG, 'Короткая']);
    const page = await loginAs(browser, 'admin');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/p/${f.projectId}/${view}`);
    const title = page.getByText(LONG, { exact: true });
    await expect(title).toBeVisible();
    const short = page.locator('[role=row][data-task]').filter({ hasText: 'Короткая' });
    const shortH = async () => Math.round((await short.boundingBox())!.height);
    const before = view === 'board' ? 0 : await shortH();
    await wrapOn(page);
    // PLANARAPP-55: a name that fits keeps its row height — only the name wraps
    if (view !== 'board') await expect.poll(shortH).toBe(before);
    await expectWrapped(page, title);
    if (view !== 'board') {
      // rows do not overlap: the next row starts below the grown one
      const rows = page.locator('[role=row][data-task]');
      const [a, b] = [(await rows.nth(0).boundingBox())!, (await rows.nth(1).boundingBox())!];
      const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
      expect(bottom.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
    }
    await page.screenshot({ path: info.outputPath(`${view}.png`) });
    if (view === 'list') {
      // hover mounts the pickers in the row; mobile shows the List as cards
      await title.hover();
      await page.waitForTimeout(500);
      await page.screenshot({ path: info.outputPath(`list-hover.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      // PLANARAPP-55: mobile cards keep their height (not pressed to the group header)
      await expect.poll(shortH).toBeGreaterThanOrEqual(64);
      await page.screenshot({ path: info.outputPath(`list-mobile.png`) });
    }
  });
