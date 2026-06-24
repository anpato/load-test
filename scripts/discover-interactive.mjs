import { chromium } from 'playwright';

const args = JSON.parse(process.argv[2] || '{}');
const { baseUrl, auth } = args;

if (!baseUrl) {
  process.stderr.write('Error: baseUrl is required\n');
  process.exit(1);
}

const origin = new URL(baseUrl).origin;
const discovered = new Set();

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

if (auth && auth.type === 'cookie' && auth.cookie) {
  process.stderr.write(`[discover] logging in at ${auth.cookie.loginUrl}\n`);
  await page.goto(auth.cookie.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });

  for (const step of auth.cookie.steps) {
    if (step.action === 'fill') {
      await page.locator(step.selector).fill(step.value);
    } else if (step.action === 'click') {
      await page.locator(step.selector).click();
    }
    if (step.waitFor === 'networkidle') {
      await page.waitForLoadState('networkidle');
    } else if (step.waitFor === 'navigation') {
      await page.waitForNavigation({ timeout: 15000 });
    }
  }
  await page.waitForLoadState('networkidle');
  process.stderr.write('[discover] login complete\n');
} else if (auth && auth.type === 'bearer' && auth.bearer?.token) {
  await context.setExtraHTTPHeaders({ Authorization: `Bearer ${auth.bearer.token}` });
} else if (auth && auth.type === 'headers' && auth.headers) {
  await context.setExtraHTTPHeaders(auth.headers);
}

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

await page.addInitScript(`(${function () {
  const _pushState = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _pushState(...args);
    window.__reportNav(location.href);
  };
  history.replaceState = function (...args) {
    _replaceState(...args);
    window.__reportNav(location.href);
  };

  window.addEventListener('popstate', () => window.__reportNav(location.href));
  window.addEventListener('hashchange', () => window.__reportNav(location.href));
}.toString()})()`);

await page.exposeFunction('__reportNav', (url) => {
  trackUrl(url);
});

page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    trackUrl(frame.url());
  }
});

context.on('page', (newPage) => {
  newPage.on('framenavigated', (frame) => {
    if (frame === newPage.mainFrame()) {
      trackUrl(frame.url());
    }
  });
});

process.stderr.write(`[discover] opening ${baseUrl} — click around to discover routes, then close the browser\n`);

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
trackUrl(page.url());

await new Promise((resolve) => {
  let done = false;
  const finish = () => { process.stderr.write('[discover] close detected\n'); if (!done) { done = true; resolve(); } };

  browser.on('disconnected', finish);
  context.on('close', finish);

  // Track all pages — when count drops to zero, user closed the window
  const pages = new Set(context.pages());
  for (const p of pages) p.on('close', () => { pages.delete(p); if (pages.size === 0) finish(); });
  context.on('page', (p) => {
    pages.add(p);
    p.on('close', () => { pages.delete(p); if (pages.size === 0) finish(); });
    p.on('framenavigated', (frame) => {
      if (frame === p.mainFrame()) trackUrl(frame.url());
    });
  });
});

const urls = [...discovered].sort();
process.stderr.write(`[discover] browser closed, captured ${urls.length} routes\n`);
process.stdout.write(JSON.stringify(urls));
