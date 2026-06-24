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

function setupPageTracking(p) {
  p.on('framenavigated', (frame) => {
    if (frame === p.mainFrame()) trackUrl(frame.url());
  });
}

context.on('page', (p) => setupPageTracking(p));

async function doLogin(p) {
  const cfg = auth.cookie;
  process.stderr.write(`[discover] logging in at ${cfg.loginUrl}\n`);

  try {
    await p.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  } catch (err) {
    process.stderr.write(`[discover] login page load: ${err.message}\n`);
    return;
  }

  for (let i = 0; i < cfg.steps.length; i++) {
    const step = cfg.steps[i];
    process.stderr.write(`[discover] login step ${i + 1}/${cfg.steps.length}: ${step.action} "${step.selector}"\n`);
    try {
      const loc = p.locator(step.selector);
      await loc.waitFor({ state: 'visible', timeout: 10000 });

      if (step.action === 'fill') {
        await loc.fill(step.value);
        process.stderr.write(`[discover]   filled with "${step.value.substring(0, 20)}${step.value.length > 20 ? '...' : ''}"\n`);
      } else if (step.action === 'click') {
        await loc.click();
        process.stderr.write(`[discover]   clicked\n`);
      }

      if (step.waitFor === 'networkidle') {
        await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      } else if (step.waitFor === 'navigation') {
        await p.waitForNavigation({ timeout: 120000 }).catch(() => {});
      }
    } catch (err) {
      process.stderr.write(`[discover]   FAILED: ${err.message}\n`);
      process.stderr.write(`[discover]   selector "${step.selector}" may be dynamic — try re-recording the login flow\n`);
    }
  }

  try {
    await p.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {}

  process.stderr.write(`[discover] login complete, now at: ${p.url()}\n`);
}

// Get the initial page and optionally log in
let activePage = context.pages()[0] || await context.newPage();

if (auth && auth.type === 'cookie' && auth.cookie) {
  await doLogin(activePage);
  // After login, the page may have been replaced by a redirect.
  // Get whatever page is currently open.
  const pages = context.pages();
  activePage = pages[pages.length - 1] || activePage;
} else if (auth && auth.type === 'bearer' && auth.bearer?.token) {
  await context.setExtraHTTPHeaders({ Authorization: `Bearer ${auth.bearer.token}` });
} else if (auth && auth.type === 'headers' && auth.headers) {
  await context.setExtraHTTPHeaders(auth.headers);
}

// Set up history interception on the active page
try {
  await activePage.addInitScript(`(${function () {
    const _pushState = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
      _pushState(...args);
      if (window.__reportNav) window.__reportNav(location.href);
    };
    history.replaceState = function (...args) {
      _replaceState(...args);
      if (window.__reportNav) window.__reportNav(location.href);
    };

    window.addEventListener('popstate', () => {
      if (window.__reportNav) window.__reportNav(location.href);
    });
  }.toString()})()`);

  await activePage.exposeFunction('__reportNav', (url) => {
    trackUrl(url);
  });
} catch (err) {
  process.stderr.write(`[discover] init script setup: ${err.message}\n`);
}

setupPageTracking(activePage);

process.stderr.write(`[discover] opening ${baseUrl} — click around to discover routes, then close the browser\n`);

try {
  await activePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
} catch (err) {
  process.stderr.write(`[discover] initial navigation: ${err.message}\n`);
}
trackUrl(activePage.url());

// Wait for user to close the browser
await new Promise((resolve) => {
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  activePage.on('close', () => { process.stderr.write('[discover] page closed\n'); finish(); });
  context.on('close', () => { process.stderr.write('[discover] context closed\n'); finish(); });
  browser.on('disconnected', () => { process.stderr.write('[discover] browser disconnected\n'); finish(); });
});

const urls = [...discovered].sort();
process.stderr.write(`[discover] captured ${urls.length} routes\n`);
process.stdout.write(JSON.stringify(urls));

await browser.close().catch(() => {});
