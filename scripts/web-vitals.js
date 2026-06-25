import { browser } from 'k6/browser';
import { SharedArray } from 'k6/data';
import { Trend, Counter, Rate } from 'k6/metrics';
import { check, sleep } from 'k6';
import http from 'k6/http';

const customLCP = new Trend('custom_lcp', true);
const customFCP = new Trend('custom_fcp', true);
const customCLS = new Trend('custom_cls');
const customTTFB = new Trend('custom_ttfb', true);
const pageErrors = new Counter('page_errors');
const successRate = new Rate('page_success_rate');

const urls = new SharedArray('target_urls', function () {
  return JSON.parse(__ENV.URLS_JSON || '[]');
});

const authConfig = JSON.parse(__ENV.AUTH_JSON || '{"type":"none"}');
const thinkTime = parseInt(__ENV.THINK_TIME || '2');

export const options = {
  scenarios: {
    web_vitals: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: JSON.parse(
        __ENV.STAGES_JSON ||
          '[{"duration":"30s","target":1},{"duration":"1m","target":1},{"duration":"15s","target":0}]'
      ),
      gracefulRampDown: '30s',
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
  },
  thresholds: {
    'custom_lcp': ['p(75)<4000'],
    'custom_fcp': ['p(75)<3000'],
    'custom_ttfb': ['p(75)<1800'],
    'custom_cls': ['p(75)<0.25'],
    'page_success_rate': ['rate>0.9'],
  },
};

export function setup() {
  console.log(`[setup] auth: ${authConfig.type}, ${urls.length} target URLs`);

  if (authConfig.type === 'bearer') {
    console.log('[setup] fetching bearer token...');
    const data = setupBearerAuth();
    console.log('[setup] bearer token acquired');
    return data;
  }
  if (authConfig.type === 'headers') {
    const hdrs = authConfig.headers || {};
    console.log(`[setup] using ${Object.keys(hdrs).length} custom headers`);
    return { headers: hdrs };
  }
  if (authConfig.type === 'cookie') {
    console.log(`[setup] cookie auth will run per-VU (login: ${authConfig.cookie.loginUrl})`);
  }
  return { headers: {} };
}

function setupBearerAuth() {
  const cfg = authConfig.bearer;
  let token = cfg.token || '';

  if (!token && cfg.tokenUrl) {
    const res = http.post(cfg.tokenUrl, JSON.stringify(cfg.credentials || {}), {
      headers: { 'Content-Type': 'application/json' },
    });
    check(res, { 'token endpoint status 2xx': (r) => r.status >= 200 && r.status < 300 });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Bearer token request failed with status ${res.status}`);
    }
    const data = res.json();
    const field = cfg.tokenField || 'token';
    token = field.split('.').reduce((obj, key) => obj && obj[key], data) || '';
  }

  return {
    headers: { Authorization: `Bearer ${token}` },
  };
}

// Login runs per-iteration because k6 browser creates an isolated context per
// browser.newPage() call — cookies from a previous page don't carry over.
// Caching vuState.authenticated was incorrect: it skipped login but the new
// page had no cookies, causing all target URLs to redirect to login.
async function doCookieLogin(page) {
  const cfg = authConfig.cookie;
  console.log(`[VU ${__VU}] cookie auth: navigating to ${cfg.loginUrl}`);
  await page.goto(cfg.loginUrl, { waitUntil: 'networkidle', timeout: 120000 });

  for (let i = 0; i < cfg.steps.length; i++) {
    const step = cfg.steps[i];
    if (!step.action) continue;
    console.log(`[VU ${__VU}] login step ${i + 1}/${cfg.steps.length}: ${step.action} on ${step.selector}`);

    if (step.action === 'fill') {
      await page.locator(step.selector).fill(step.value);
    } else if (step.action === 'click') {
      await page.locator(step.selector).click();
    }

    if (step.waitFor === 'networkidle') {
      await page.waitForLoadState('networkidle');
    } else if (step.waitFor === 'navigation') {
      await page.waitForNavigation({ timeout: 120000 });
    }
  }

  await page.waitForLoadState('networkidle');
  console.log(`[VU ${__VU}] cookie auth: login complete (now at ${page.url()})`);
}

export default async function (data) {
  if (urls.length === 0) {
    console.log(`[VU ${__VU}] no URLs to test, skipping`);
    return;
  }

  const url = urls[(__ITER + __VU) % urls.length];
  console.log(`[VU ${__VU}][iter ${__ITER}] testing ${url}`);

  const page = await browser.newPage();

  try {
    if (data.headers && Object.keys(data.headers).length > 0) {
      await page.setExtraHTTPHeaders(data.headers);
    }

    if (authConfig.type === 'cookie') {
      await doCookieLogin(page);
    }

    console.log(`[VU ${__VU}][iter ${__ITER}] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });

    if (authConfig.type === 'cookie' && authConfig.cookie?.loginUrl) {
      const loginPath = new URL(authConfig.cookie.loginUrl).pathname;
      const currentPath = new URL(page.url()).pathname;
      if (currentPath === loginPath && url !== authConfig.cookie.loginUrl) {
        throw new Error(`Redirected to login — auth may have failed (landed on ${page.url()})`);
      }
    }

    const vitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        const result = { lcp: 0, fcp: 0, cls: 0, ttfb: 0 };

        const navEntry = performance.getEntriesByType('navigation')[0];
        if (navEntry) result.ttfb = navEntry.responseStart;

        const fcpEntry = performance.getEntriesByName(
          'first-contentful-paint'
        )[0];
        if (fcpEntry) result.fcp = fcpEntry.startTime;

        let lastLCP = 0;
        try {
          const lcpObs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0)
              lastLCP = entries[entries.length - 1].startTime;
          });
          lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (e) {
          /* not supported */
        }

        let clsScore = 0;
        let sessionValue = 0;
        let sessionEntries = [];
        try {
          const clsObs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                const first = sessionEntries[0];
                const last = sessionEntries[sessionEntries.length - 1];
                if (
                  !first ||
                  (entry.startTime - last.startTime < 1000 &&
                    entry.startTime - first.startTime < 5000)
                ) {
                  sessionValue += entry.value;
                  sessionEntries.push(entry);
                } else {
                  clsScore = Math.max(clsScore, sessionValue);
                  sessionValue = entry.value;
                  sessionEntries = [entry];
                }
                clsScore = Math.max(clsScore, sessionValue);
              }
            }
          });
          clsObs.observe({ type: 'layout-shift', buffered: true });
        } catch (e) {
          /* not supported */
        }

        setTimeout(() => {
          result.lcp = lastLCP;
          result.cls = clsScore;
          resolve(result);
        }, 3000);
      });
    });

    if (vitals.lcp === 0 && vitals.fcp === 0 && vitals.ttfb === 0) {
      throw new Error('No performance entries collected — page may not have loaded');
    }

    console.log(`[VU ${__VU}][iter ${__ITER}] vitals: LCP=${vitals.lcp.toFixed(0)}ms FCP=${vitals.fcp.toFixed(0)}ms CLS=${vitals.cls.toFixed(3)} TTFB=${vitals.ttfb.toFixed(0)}ms`);

    customLCP.add(vitals.lcp, { url: url });
    customFCP.add(vitals.fcp, { url: url });
    customCLS.add(vitals.cls, { url: url });
    customTTFB.add(vitals.ttfb, { url: url });
    successRate.add(1);
  } catch (err) {
    console.error(`[VU ${__VU}][iter ${__ITER}] ERROR on ${url}: ${err.message}`);
    pageErrors.add(1, { url: url, error: err.message });
    successRate.add(0);
  } finally {
    await page.close();
  }

  sleep(thinkTime);
}
