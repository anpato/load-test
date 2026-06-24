import { test, expect } from '@playwright/test';

const BASE_URL = 'https://swing-admin.apps.dev-01.6cclab.dev';
const PATHS = ['/users', '/swings', '/analyze'];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

async function addManualRoutes(page: import('@playwright/test').Page) {
  const baseUrlInput = page.locator('input[type="url"]').nth(1);
  await baseUrlInput.fill(BASE_URL);
  for (const path of PATHS) {
    await page.getByPlaceholder('/products/:id').fill(path);
    await page.getByRole('main').getByRole('button', { name: 'Add Route' }).click();
  }
  await page.getByRole('button', { name: 'Expand & Preview' }).click();
  await expect(page.getByText('3 URLs expanded')).toBeVisible({ timeout: 10000 });
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('01 - discover routes', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText('Web Vitals Load Tester')).toBeVisible();
      await page.screenshot({
        path: `screenshots/${vp.name}-01-discover-empty.png`,
        fullPage: true,
      });

      await addManualRoutes(page);
      await page.screenshot({
        path: `screenshots/${vp.name}-01-discover-routes-added.png`,
        fullPage: true,
      });
    });

    test('02 - select routes', async ({ page }) => {
      await page.goto('/');
      await addManualRoutes(page);
      await page.getByRole('button', { name: /Continue with \d+ routes/ }).click();
      await expect(page.getByRole('heading', { name: 'Select Routes to Test' })).toBeVisible();
      await page.screenshot({
        path: `screenshots/${vp.name}-02-select-routes.png`,
        fullPage: true,
      });
    });

    test('03 - auth config', async ({ page }) => {
      await page.goto('/');
      await addManualRoutes(page);
      await page.getByRole('button', { name: /Continue with \d+ routes/ }).click();
      await page.getByRole('button', { name: /Continue \(\d+ selected\)/ }).click();
      await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible();
      await page.screenshot({
        path: `screenshots/${vp.name}-03-auth-none.png`,
        fullPage: true,
      });

      await page.getByRole('button', { name: 'Cookie Login' }).click();
      await page.screenshot({
        path: `screenshots/${vp.name}-03-auth-cookie.png`,
        fullPage: true,
      });
    });

    test('04 - run config', async ({ page }) => {
      await page.goto('/');
      await addManualRoutes(page);
      await page.getByRole('button', { name: /Continue with \d+ routes/ }).click();
      await page.getByRole('button', { name: /Continue \(\d+ selected\)/ }).click();
      await page.getByRole('main').getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Configure Load Test' })).toBeVisible();
      await page.screenshot({
        path: `screenshots/${vp.name}-04-config-smoke.png`,
        fullPage: true,
      });

      await page.getByRole('button', { name: /Custom/i }).click();
      await page.screenshot({
        path: `screenshots/${vp.name}-04-config-custom.png`,
        fullPage: true,
      });
    });

    test('05 - running dashboard', async ({ page }) => {
      await page.goto('/');
      await addManualRoutes(page);
      await page.getByRole('button', { name: /Continue with \d+ routes/ }).click();
      await page.getByRole('button', { name: /Continue \(\d+ selected\)/ }).click();
      await page.getByRole('main').getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: 'Start test' }).click();

      await expect(page.getByRole('button', { name: '■ Stop test' })).toBeVisible({ timeout: 5000 });
      await page.screenshot({
        path: `screenshots/${vp.name}-05-running-initial.png`,
        fullPage: true,
      });

      // Wait a few seconds for some logs to appear
      await page.waitForTimeout(3000);
      await page.screenshot({
        path: `screenshots/${vp.name}-05-running-with-logs.png`,
        fullPage: true,
      });
    });

    test('06 - run history', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Run History' }).click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `screenshots/${vp.name}-06-history.png`,
        fullPage: true,
      });
    });
  });
}
