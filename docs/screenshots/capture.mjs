import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:5173';
const TARGET_URL = 'https://example.com';
const PATHS = ['/users', '/products', '/about'];

async function screenshot(page, name) {
  const path = join(__dirname, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  captured ${name}`);
}

async function addManualRoutes(page) {
  const baseUrlInput = page.locator('input[type="url"]').nth(1);
  await baseUrlInput.fill(TARGET_URL);
  for (const p of PATHS) {
    await page.getByPlaceholder('/products/:id').fill(p);
    await page.getByRole('main').getByRole('button', { name: 'Add route' }).click();
  }
  await page.getByRole('button', { name: 'Expand & preview' }).click();
  await page.getByText('3 URLs expanded').waitFor({ timeout: 10000 });
}

async function captureFlow(page, prefix) {
  // 1. Discover routes
  await page.goto(BASE);
  await page.getByText('Web Vitals Load Tester').waitFor();
  await screenshot(page, `${prefix}-01-discover`);

  // Add routes
  await addManualRoutes(page);
  await screenshot(page, `${prefix}-02-routes-added`);

  // 2. Select routes
  await page.getByRole('button', { name: /Continue with \d+ routes/ }).click();
  await page.getByRole('heading', { name: 'Select Routes to Test' }).waitFor();
  await screenshot(page, `${prefix}-03-select-routes`);

  // 3. Auth config
  await page.getByRole('button', { name: /Continue \(\d+ selected\)/ }).click();
  await page.getByRole('heading', { name: 'Authentication' }).waitFor();
  await screenshot(page, `${prefix}-04-auth`);

  // 4. Configure test
  await page.getByRole('main').getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Configure Load Test' }).waitFor();
  await screenshot(page, `${prefix}-05-configure`);

  // 5. Run history
  await page.goto(BASE);
  await page.getByText('Web Vitals Load Tester').waitFor();
  await page.getByRole('button', { name: 'Run History' }).click();
  await page.waitForTimeout(500);
  await screenshot(page, `${prefix}-06-history`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  console.log('Capturing light mode...');
  const lightPage = await context.newPage();
  await captureFlow(lightPage, 'light');

  console.log('Capturing dark mode...');
  const darkPage = await context.newPage();
  await darkPage.goto(BASE);
  await darkPage.evaluate(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  });
  await captureFlow(darkPage, 'dark');

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
