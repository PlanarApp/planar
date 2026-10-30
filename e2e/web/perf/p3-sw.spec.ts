import { expect, test } from '@playwright/test';
import { uuidv7 } from '../../lib';
import { fixture, loginAs, uniq } from '../helpers';
import { slug16 } from '../p3-helpers';

// Prod build (stack.sh, PERF_MODULES=forms): the service worker must not replace /f/<slug> with the app shell.
test('p3-sw: с зарегистрированным SW /f/<slug> открывает страницу формы, а не приложение', async ({
  browser,
}) => {
  const f = await fixture([uniq('SW')]);
  const slug = slug16();
  const title = uniq('Форма SW');
  await f.admin.pushOk([
    f.admin.mut('forms.create', {
      id: uuidv7(),
      projectId: f.projectId,
      slug,
      title,
      statusId: f.statusIds[0],
      fields: [{ key: 'title', label: 'Заголовок', required: true }],
    }),
  ]);
  const page = await loginAs(browser, 'alice');
  const active = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  expect(active).toBe(true);
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
});
