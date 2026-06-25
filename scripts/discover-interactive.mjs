import { chromium } from 'playwright';

const args = JSON.parse(process.argv[2] || '{}');
const { baseUrl, auth } = args;

if (!baseUrl) {
  process.stderr.write('Error: baseUrl is required\n');
  process.exit(1);
}

const origin = new URL(baseUrl).origin;
const discovered = new Set();

function trackUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return;
    parsed.hash = '';
    parsed.search = '';
    const clean = parsed.origin + (parsed.pathname.replace(/\/+$/, '') || '/');
    if (!discovered.has(clean)) {
      discovered.add(clean);
      process.stderr.write(`[discover] + ${clean}\n`);
    }
  } catch {}
}

// Authenticate headlessly first, then carry cookies into the visible browser
let storageState;
if (auth && auth.type === 'cookie' && auth.cookie) {
  process.stderr.write(`[discover] authenticating headlessly at ${auth.cookie.loginUrl}\n`);
  const headless = await chromium.launch({ headless: true });
  const ctx = await headless.newContext();
  const page = await ctx.newPage();

  try {
    await page.goto(auth.cookie.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    for (const step of auth.cookie.steps) {
      const loc = page.locator(step.selector);
      await loc.waitFor({ state: 'visible', timeout: 10000 });
      if (step.action === 'fill') await loc.fill(step.value);
      else if (step.action === 'click') await loc.click();

      if (step.waitFor === 'networkidle')
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      else if (step.waitFor === 'navigation')
        await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    storageState = await ctx.storageState();
    process.stderr.write(`[discover] authenticated successfully\n`);
  } catch (err) {
    process.stderr.write(`[discover] headless auth failed: ${err.message}\n`);
    process.stderr.write(`[discover] continuing without auth — log in manually in the browser\n`);
  }

  await headless.close();
}

// Open the visible browser with auth context already applied
const browser = await chromium.launch({ headless: false });
const contextOpts = {};
if (storageState) contextOpts.storageState = storageState;
const context = await browser.newContext(contextOpts);

// Bearer / custom headers
if (auth && auth.type === 'bearer' && auth.bearer?.token) {
  await context.setExtraHTTPHeaders({ Authorization: `Bearer ${auth.bearer.token}` });
} else if (auth && auth.type === 'headers' && auth.headers) {
  await context.setExtraHTTPHeaders(auth.headers);
}

const page = await context.newPage();

// Track SPA navigations
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) trackUrl(frame.url());
});

context.on('page', (p) => {
  p.on('framenavigated', (frame) => {
    if (frame === p.mainFrame()) trackUrl(frame.url());
  });
});

try {
  await page.addInitScript(`(${function () {
    const _push = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState = function (...a) { _push(...a); if (window.__reportNav) window.__reportNav(location.href); };
    history.replaceState = function (...a) { _replace(...a); if (window.__reportNav) window.__reportNav(location.href); };
    window.addEventListener('popstate', () => { if (window.__reportNav) window.__reportNav(location.href); });
  }.toString()})()`);
  await page.exposeFunction('__reportNav', (url) => trackUrl(url));
} catch {}

process.stderr.write(`[discover] opening ${baseUrl} — browse around, then close the browser\n`);
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
trackUrl(page.url());

// Wait for user to close the browser
await new Promise((resolve) => {
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  page.on('close', finish);
  context.on('close', finish);
  browser.on('disconnected', finish);
});

const urls = [...discovered].sort();
process.stderr.write(`[discover] captured ${urls.length} routes\n`);
process.stdout.write(JSON.stringify(urls));
await browser.close().catch(() => {});
