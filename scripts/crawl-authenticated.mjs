import { chromium } from 'playwright';

const args = JSON.parse(process.argv[2] || '{}');
const { baseUrl, maxDepth = 3, maxPages = 50, auth } = args;

if (!baseUrl) {
  process.stderr.write('Error: baseUrl is required\n');
  process.exit(1);
}

const visited = new Set();
const discovered = new Set();
const origin = new URL(baseUrl).origin;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

if (auth && auth.type === 'cookie' && auth.cookie) {
  process.stderr.write(`[crawl] logging in at ${auth.cookie.loginUrl}\n`);
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
  process.stderr.write('[crawl] login complete\n');
} else if (auth && auth.type === 'bearer' && auth.bearer) {
  const token = auth.bearer.token || '';
  if (token) {
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${token}`,
    });
  }
} else if (auth && auth.type === 'headers' && auth.headers) {
  await context.setExtraHTTPHeaders(auth.headers);
}

async function extractLinks(p) {
  return await p.evaluate((orig) => {
    const links = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      try {
        const url = new URL(a.href, document.location.href);
        url.hash = '';
        url.search = '';
        if (url.origin === orig && url.pathname !== '') {
          links.add(url.origin + url.pathname.replace(/\/+$/, '') || '/');
        }
      } catch {}
    });
    return [...links];
  }, origin);
}

const queue = [{ url: baseUrl.replace(/\/+$/, ''), depth: 0 }];

while (queue.length > 0 && visited.size < maxPages) {
  const { url, depth } = queue.shift();

  const normalized = url.replace(/\/+$/, '') || origin;
  if (visited.has(normalized)) continue;
  visited.add(normalized);

  process.stderr.write(`[crawl] [depth=${depth}] ${normalized}\n`);

  try {
    const response = await page.goto(normalized, {
      waitUntil: 'networkidle',
      timeout: 15000,
    });

    if (!response || response.status() >= 400) {
      process.stderr.write(`[crawl] skipping ${normalized} (status: ${response?.status()})\n`);
      continue;
    }

    const finalUrl = page.url();
    const finalParsed = new URL(finalUrl);
    if (finalParsed.origin === origin) {
      const cleanPath = finalParsed.origin + finalParsed.pathname.replace(/\/+$/, '');
      discovered.add(cleanPath || origin);
    }

    if (depth < maxDepth) {
      const links = await extractLinks(page);
      for (const link of links) {
        if (!visited.has(link) && link.startsWith(origin)) {
          discovered.add(link);
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[crawl] error on ${normalized}: ${err.message}\n`);
  }
}

await browser.close();

const urls = [...discovered].sort();
process.stderr.write(`[crawl] finished: ${urls.length} URLs discovered\n`);
process.stdout.write(JSON.stringify(urls));
