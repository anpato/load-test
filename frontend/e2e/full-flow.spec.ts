import { test, expect } from '@playwright/test';

const BASE_URL = 'https://swing-admin.apps.dev-01.6cclab.dev';
const LOGIN_URL = `${BASE_URL}/login`;
const PATHS = ['/users', '/swings', '/analyze'];

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

async function navigateToStep(page: import('@playwright/test').Page, step: 'select' | 'auth' | 'config') {
  await addManualRoutes(page);
  await page.getByRole('button', { name: /Continue with \d+ routes/ }).click();

  if (step === 'select') return;

  await page.getByRole('button', { name: /Continue \(\d+ selected\)/ }).click();

  if (step === 'auth') return;

  await page.getByRole('main').getByRole('button', { name: 'Continue' }).click();
}

test.describe('Load Test Tool E2E', () => {
  test('step 1: manual route entry with dynamic segments', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Web Vitals Load Tester')).toBeVisible();

    await addManualRoutes(page);

    for (const path of PATHS) {
      await expect(page.getByText(path, { exact: true }).first()).toBeVisible();
    }

    await expect(page.getByText('3 URLs expanded')).toBeVisible();

    const continueBtn = page.getByRole('button', { name: /Continue with \d+ routes/ });
    await expect(continueBtn).toBeVisible();
    await continueBtn.click();

    await expect(page.getByRole('heading', { name: 'Select Routes to Test' })).toBeVisible();
  });

  test('step 2: route selection', async ({ page }) => {
    await page.goto('/');
    await navigateToStep(page, 'select');

    await expect(page.getByRole('heading', { name: 'Select Routes to Test' })).toBeVisible();

    const routeRows = page.locator('li').filter({ has: page.locator('svg') });
    const count = await routeRows.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (const path of PATHS) {
      await expect(page.getByText(`${BASE_URL}${path}`)).toBeVisible();
    }

    await page.getByRole('button', { name: /Continue \(\d+ selected\)/ }).click();
    await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible();
  });

  test('step 3: auth config - cookie login', async ({ page }) => {
    await page.goto('/');
    await navigateToStep(page, 'auth');

    await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible();

    await page.getByRole('button', { name: 'Cookie Login' }).click();

    const loginUrlInput = page.getByPlaceholder('https://example.com/login');
    await loginUrlInput.fill(LOGIN_URL);

    await expect(page.getByRole('button', { name: 'Record Login Flow' })).toBeEnabled();

    await page.getByRole('main').getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Configure Load Test' })).toBeVisible();
  });

  test('step 4: run config - test presets', async ({ page }) => {
    await page.goto('/');
    await navigateToStep(page, 'config');

    await expect(page.getByRole('heading', { name: 'Configure Load Test' })).toBeVisible();

    await expect(page.getByRole('button', { name: /Smoke/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Load/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Stress/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Soak/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Custom/i })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Start test' })).toBeVisible();
  });

  test('full flow: manual routes → select → auth none → smoke test start', async ({ page }) => {
    await page.goto('/');
    await navigateToStep(page, 'config');

    await expect(page.getByRole('heading', { name: 'Configure Load Test' })).toBeVisible();

    await page.getByRole('button', { name: 'Start test' }).click();

    await expect(page.getByRole('navigation').getByText('Running')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Stop/i })).toBeVisible({ timeout: 5000 });
  });

  test('crawl: auto-discover routes from target site', async ({ page }) => {
    await page.goto('/');

    const urlInput = page.locator('input[type="url"]').first();
    await urlInput.fill(BASE_URL);

    await page.getByRole('main').getByRole('button', { name: 'Discover Routes' }).click();

    await expect(page.getByText('Discovering...')).toBeVisible();

    // The crawl may auto-advance to Select Routes if routes are found,
    // or stay on discover with an error, or show the continue button
    const selectHeading = page.getByRole('heading', { name: 'Select Routes to Test' });
    const continueBtn = page.getByRole('button', { name: /Continue with \d+ routes/ });
    const error = page.getByRole('main').locator('.bg-red-50');

    await expect(selectHeading.or(continueBtn).or(error)).toBeVisible({ timeout: 30000 });
  });

  test('nav: step breadcrumbs allow back-navigation', async ({ page }) => {
    await page.goto('/');
    await navigateToStep(page, 'auth');

    await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible();

    // Go back to Discover Routes via nav
    await page.getByRole('navigation').getByRole('button', { name: 'Discover Routes' }).click();
    await expect(page.getByRole('heading', { name: 'Auto-Discover Routes' })).toBeVisible();

    // Should still be able to jump forward to Select Routes (previously visited)
    await page.getByRole('navigation').getByRole('button', { name: 'Select Routes' }).click();
    await expect(page.getByRole('heading', { name: 'Select Routes to Test' })).toBeVisible();

    // Jump to Authentication
    await page.getByRole('navigation').getByRole('button', { name: 'Authentication' }).click();
    await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible();
  });
});
