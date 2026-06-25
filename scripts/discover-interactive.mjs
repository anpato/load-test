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
    process.stderr.write(`[discover] login page load failed: ${err.message}\n`);
    process.stderr.write(`[discover] please log in manually, then navigate to your target site\n`);
    return;
  }

  let autoLoginFailed = false;
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
      autoLoginFailed = true;
      break;
    }
  }

  if (autoLoginFailed) {
    process.stderr.write(`[discover] auto-login failed — please complete login manually in the browser\n`);
    process.stderr.write(`[discover] waiting for navigation away from login page...\n`);
    try {
      const loginUrl = p.url();
      await p.waitForFunction(
        (startUrl) => window.location.href !== startUrl,
        loginUrl,
        { timeout: 300000 }
      );
    } catch {
      process.stderr.write(`[discover] manual login wait ended\n`);
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
  // After login, the page may have been replaced or crashed.
  // Verify the page is still usable; if not, open a fresh one.
  const pages = context.pages();
  const livePage = pages[pages.length - 1];
  try {
    if (livePage) await livePage.url();
    activePage = livePage || activePage;
  } catch {
    process.stderr.write('[discover] page died during login, opening fresh page\n');
    activePage = await context.newPage();
  }
} else if (auth && auth.type === 'bearer' && auth.bearer?.token) {
  await context.setExtraHTTPHeaders({ Authorization: `Bearer ${auth.bearer.token}` });
} else if (auth && auth.type === 'headers' && auth.headers) {
  await context.setExtraHTTPHeaders(auth.headers);
}

async function initPage(p) {
  try {
    await p.addInitScript(`(${function () {
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

    await p.exposeFunction('__reportNav', (url) => {
      trackUrl(url);
    });
  } catch (err) {
    process.stderr.write(`[discover] init script setup: ${err.message}\n`);
  }
  setupPageTracking(p);
}

async function ensureLivePage() {
  const pages = context.pages();
  for (const p of pages.reverse()) {
    try {
      p.url();
      return p;
    } catch {}
  }
  return await context.newPage();
}

await initPage(activePage);

process.stderr.write(`[discover] opening ${baseUrl} — click around to discover routes, then close the browser\n`);

try {
  await activePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
} catch (err) {
  process.stderr.write(`[discover] navigation failed, recovering: ${err.message}\n`);
  activePage = await ensureLivePage();
  await initPage(activePage);
  try {
    await activePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  } catch (retryErr) {
    process.stderr.write(`[discover] retry also failed: ${retryErr.message}\n`);
  }
}
try { trackUrl(activePage.url()); } catch {}

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
